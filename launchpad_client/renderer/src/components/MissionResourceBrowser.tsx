import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import { decodePaaFromPath, fetchMissionProjectTree, getP3dPreviewMeshFromPath, type ProjectTreeNode } from '../api/launchpad'
import { ImagePreview } from './ImagePreview.tsx'
import { P3dPreview } from './P3dPreview.tsx'
import { Spinner } from './Spinner'
import { ScriptEditorSearchPanel } from './Editor/ScriptEditorSearchPanel'
import { ScriptEditorTabs, type OpenFileTab } from './Editor/ScriptEditorTabs'
import { ScriptEditorGoTo } from './Editor/ScriptEditorGoTo'
import { FileTree, fileBasename, parentDirRel, ancestorDirRelPathsForFile, firstFileRelDepthFirst, isPaaRel, isP3dRel } from './Editor/FileTree/FileTree'
import { type InlineEditState } from './Editor/FileTree/FileTreeInlineEdit'
import { useAppPreferences } from '../context/AppPreferencesContext'
import {
  ensureMissionMonacoShiki,
  missionMonacoTheme,
  missionResourceLanguage,
} from '../missionMonacoSetup'
import Util, { type HemttDiagnostic } from '../utils'

const LS_SHOW_MINIMAP = 'launchpad.editorShowMinimap'
const LS_SHOW_FOLDING = 'launchpad.editorShowFolding'

function readStoredMinimap(): boolean {
  try {
    return localStorage.getItem(LS_SHOW_MINIMAP) === 'true'
  } catch {
    return false
  }
}

function readStoredFolding(): boolean {
  try {
    return localStorage.getItem(LS_SHOW_FOLDING) !== 'false'
  } catch {
    return true
  }
}

function joinProjectPath(root: string, relPosix: string): string {
  const base = root.replace(/[/\\]+$/, '')
  if (!relPosix) return base
  const win = root.includes('\\')
  const parts = relPosix.split('/').filter(Boolean)
  return win ? [base, ...parts].join('\\') : [base, ...parts].join('/')
}

function dirnameAbs(absPath: string): string {
  const i = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'))
  return i <= 0 ? absPath : absPath.slice(0, i)
}

function normalizePathKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

/** Project-relative path (posix) from absolute ``filePath``, or null if outside root. */
function relFromProjectRoot(projectRoot: string, filePath: string): string | null {
  const root = normalizePathKey(projectRoot.replace(/[/\\]+$/, ''))
  const file = normalizePathKey(filePath)
  if (!file.startsWith(root)) return null
  const tail = file.slice(root.length).replace(/^[/\\]+/, '')
  return tail ? tail.replace(/\\/g, '/') : null
}

function normalizeDiagSeverity(s: string): HemttDiagnostic['severity'] {
  const x = s.toLowerCase()
  if (x === 'warning') return 'warning'
  if (x === 'help' || x === 'note') return 'help'
  return 'error'
}

/** Resolve a diagnostic path segment the same way the desktop check does (absolute or under project). */
function resolveDiagnosticFile(projectRoot: string, rawPath: string): string {
  const t = rawPath.trim()
  if (!t) return joinProjectPath(projectRoot, 'unknown')
  if (/^[A-Za-z]:[\\/]/.test(t) || t.startsWith('/') || t.startsWith('\\\\')) {
    const win = projectRoot.includes('\\')
    return win ? t.replace(/\//g, '\\') : t.replace(/\\/g, '/')
  }
  return joinProjectPath(projectRoot, t)
}

/**
 * ``path:line:col: error|warning: message`` or ``path:line: error|warning:`` (matches HEMTT / rustc-style lines).
 */
function parseGccStyleDiagnosticLine(projectRoot: string, line: string): HemttDiagnostic | null {
  const sevMatch = /:\s*(error|warning|note|help)\s*:\s*(.+)$/.exec(line)
  if (!sevMatch) return null
  const prefix = line.slice(0, sevMatch.index)
  const two = /:(\d+):(\d+)$/.exec(prefix)
  if (two) {
    const filePart = prefix.slice(0, two.index)
    if (!filePart.trim()) return null
    const ln = parseInt(two[1], 10)
    const col = parseInt(two[2], 10)
    return {
      severity: normalizeDiagSeverity(sevMatch[1]),
      message: sevMatch[2].trim(),
      file: resolveDiagnosticFile(projectRoot, filePart.trim()),
      line: Number.isFinite(ln) ? ln : undefined,
      column: Number.isFinite(col) ? col : undefined,
    }
  }
  const one = /:(\d+)$/.exec(prefix)
  if (!one) return null
  const filePart = prefix.slice(0, one.index)
  if (!filePart.trim()) return null
  const ln = parseInt(one[1], 10)
  return {
    severity: normalizeDiagSeverity(sevMatch[1]),
    message: sevMatch[2].trim(),
    file: resolveDiagnosticFile(projectRoot, filePart.trim()),
    line: Number.isFinite(ln) ? ln : undefined,
  }
}

function applyHemttMarkers(
  shell: { editor: Parameters<OnMount>[0]; monaco: Parameters<OnMount>[1] } | null,
  projectRoot: string,
  selectedRel: string | null,
  diagnostics: HemttDiagnostic[],
) {
  if (!shell?.editor.getModel() || !selectedRel) return
  const model = shell.editor.getModel()!
  const activeAbs = normalizePathKey(joinProjectPath(projectRoot, selectedRel))
  const S = shell.monaco.MarkerSeverity
  const markers = diagnostics
    .filter(
      (d) =>
        d.file &&
        d.line != null &&
        normalizePathKey(d.file) === activeAbs,
    )
    .map((d) => ({
      startLineNumber: d.line!,
      startColumn: Math.max(1, d.column ?? 1),
      endLineNumber: d.line!,
      endColumn: Math.max(1, (d.column ?? 1) + 1),
      message: d.message,
      severity:
        d.severity === 'warning'
          ? S.Warning
          : d.severity === 'help' || d.severity === 'info'
            ? S.Info
            : S.Error,
    }))
  shell.monaco.editor.setModelMarkers(model, 'hemtt', markers)
}

export type ScriptEditorEnvironment = 'mission' | 'mod'

function sanitizeFileLabel(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (t.includes('/') || t.includes('\\')) return null
  if (t === '.' || t === '..') return null
  if (t.includes('\0')) return null
  return t
}

const LS_SIDEBAR_W = 'launchpad.resourceSidebarWidth'
const LS_PROBLEMS_H = 'launchpad.resourceProblemsHeight'
const SIDEBAR_MIN = 200
const EDITOR_MIN = 240
const PROBLEMS_MIN = 80
const PROBLEMS_MAX = 560

function readStoredSidebarWidth(): number {
  try {
    const v = localStorage.getItem(LS_SIDEBAR_W)
    if (v == null) return 300
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 300
  } catch {
    return 300
  }
}

function readStoredProblemsHeight(): number {
  try {
    const v = localStorage.getItem(LS_PROBLEMS_H)
    if (v == null) return 200
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 200
  } catch {
    return 200
  }
}

type Props = {
  projectRoot: string
  disabled?: boolean
  /** ``mod`` enables HEMTT project checks and a problems list; ``mission`` keeps editor-only behaviour. */
  environment?: ScriptEditorEnvironment
  contextTitle?: string
  fullscreen?: boolean
  onFullscreenToggle?: () => void
  onClose?: () => void
}

export function MissionResourceBrowser({ projectRoot, disabled, environment = 'mission', contextTitle, fullscreen, onFullscreenToggle, onClose }: Props) {
  const { useSyntaxHighlighting } = useAppPreferences()
  const [tree, setTree] = useState<ProjectTreeNode | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [treeErr, setTreeErr] = useState<string | null>(null)
  const [treeLoading, setTreeLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [selectedRel, setSelectedRel] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [texturePreview, setTexturePreview] = useState<{
    width: number
    height: number
    data: Uint8Array
  } | null>(null)
  const [meshPreview, setMeshPreview] = useState<{
    positions: Float32Array
    indices: Uint32Array
    normals: Float32Array
    uvs: Float32Array | null
    textureNames: string[]
    modelDirectory: string
  } | null>(null)
  const [fileErr, setFileErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savingRel, setSavingRel] = useState<string | null>(null)
  const [bufferVersion, setBufferVersion] = useState(0)
  const [monacoReady, setMonacoReady] = useState(false)
  const [lintDiagnostics, setLintDiagnostics] = useState<HemttDiagnostic[]>([])
  const [lintRunning, setLintRunning] = useState(false)
  const [lintToolError, setLintToolError] = useState<string | null>(null)
  const monacoShellRef = useRef<{ editor: Parameters<OnMount>[0]; monaco: Parameters<OnMount>[1] } | null>(null)
  const lintDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lintSeqRef = useRef(0)
  const selectedRelRef = useRef<string | null>(null)
  const fileContentRef = useRef('')
  const originalContentRef = useRef('')
  const dirtyRef = useRef(false)
  const openFileBuffersRef = useRef(new Map<string, { text: string; dirty: boolean }>())
  const initialTreeSelectionDoneRef = useRef(false)
  const jumpTargetRef = useRef<{ rel: string; line: number; column?: number } | null>(null)
  const [jumpNonce, setJumpNonce] = useState(0)
  type PathDialogState = { kind: 'new'; parentRel: string } | { kind: 'rename'; fileRel: string }
  const [pathDialog, setPathDialog] = useState<PathDialogState | null>(null)
  const [pathDialogInput, setPathDialogInput] = useState('')
  const [pathActionErr, setPathActionErr] = useState<string | null>(null)
  const [pathActionBusy, setPathActionBusy] = useState(false)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const pathDialogTitleId = useId()
  const pathDialogFieldId = useId()
  const layoutRef = useRef<HTMLDivElement>(null)
  const editorStackRef = useRef<HTMLDivElement>(null)
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth)
  const [problemsHeight, setProblemsHeight] = useState(readStoredProblemsHeight)
  const [wideLayout, setWideLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 721px)').matches,
  )
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const [searchPanelReplaceMode, setSearchPanelReplaceMode] = useState(false)
  const [goToOpen, setGoToOpen] = useState(false)
  const [goToMode, setGoToMode] = useState<'line' | 'symbol'>('line')
  const [searchPanelFocusTick, setSearchPanelFocusTick] = useState(0)
  const [editorReadyTick, setEditorReadyTick] = useState(0)
  const [showMinimap] = useState(readStoredMinimap)
  const [showFolding] = useState(readStoredFolding)
  const searchPanelOpenRef = useRef(false)
  const goToOpenRef = useRef(false)
  const [inlineEditState, setInlineEditState] = useState<InlineEditState>(null)

  useEffect(() => {
    searchPanelOpenRef.current = searchPanelOpen
  }, [searchPanelOpen])

  useEffect(() => {
    goToOpenRef.current = goToOpen
  }, [goToOpen])

  const getEditorShell = useCallback(() => monacoShellRef.current, [])

  const readProjectFile = useCallback(
    async (rel: string) => {
      const abs = joinProjectPath(projectRoot, rel)
      return Util.getFileContents(abs)
    },
    [projectRoot],
  )

  useEffect(() => {
    setSearchPanelOpen(false)
    setGoToOpen(false)
  }, [selectedRel])

  const openTabs = useMemo<OpenFileTab[]>(() => {
    void bufferVersion
    const tabs: OpenFileTab[] = []
    openFileBuffersRef.current.forEach((buf, rel) => {
      if (!isPaaRel(rel) && !isP3dRel(rel)) {
        tabs.push({ rel, dirty: rel === selectedRel ? dirty : buf.dirty })
      }
    })
    if (selectedRel && !isPaaRel(selectedRel) && !isP3dRel(selectedRel)) {
      if (!tabs.some((t) => t.rel === selectedRel)) {
        const buf = openFileBuffersRef.current.get(selectedRel)
        tabs.push({ rel: selectedRel, dirty: buf ? buf.dirty : false })
      }
    }
    return tabs
  }, [selectedRel, dirty, bufferVersion])


  useEffect(() => {
    const mq = window.matchMedia('(min-width: 721px)')
    const fn = () => setWideLayout(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  useEffect(() => {
    const clamp = () => {
      const root = layoutRef.current
      if (!root || !wideLayout) return
      const rw = root.getBoundingClientRect().width
      const maxW = Math.max(SIDEBAR_MIN, rw - EDITOR_MIN)
      setSidebarWidth((w) => Math.max(SIDEBAR_MIN, Math.min(w, maxW)))
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => window.removeEventListener('resize', clamp)
  }, [wideLayout])

  useEffect(() => {
    const clamp = () => {
      const stack = editorStackRef.current
      if (!stack || environment !== 'mod') return
      const h = stack.getBoundingClientRect().height
      const maxH = Math.max(PROBLEMS_MIN, h - 160)
      setProblemsHeight((ph) => Math.max(PROBLEMS_MIN, Math.min(ph, maxH, PROBLEMS_MAX)))
    }
    const t = window.setTimeout(clamp, 0)
    window.addEventListener('resize', clamp)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', clamp)
    }
  }, [environment, selectedRel, wideLayout, monacoReady])

  const onSidebarResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || !wideLayout) return
      e.preventDefault()
      const startX = e.clientX
      const startW = sidebarWidth
      const drag = { lastW: startW }
      const onMove = (ev: PointerEvent) => {
        const root = layoutRef.current
        if (!root) return
        const rw = root.getBoundingClientRect().width
        const maxW = Math.max(SIDEBAR_MIN, rw - EDITOR_MIN)
        const delta = ev.clientX - startX
        const next = Math.max(SIDEBAR_MIN, Math.min(startW + delta, maxW))
        drag.lastW = next
        setSidebarWidth(next)
      }
      const onUp = () => {
        try {
          localStorage.setItem(LS_SIDEBAR_W, String(drag.lastW))
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [sidebarWidth, wideLayout],
  )

  const onProblemsResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || environment !== 'mod') return
      e.preventDefault()
      const stack = editorStackRef.current
      if (!stack) return
      const startY = e.clientY
      const startH = problemsHeight
      const drag = { lastH: startH }
      const onMove = (ev: PointerEvent) => {
        const el = editorStackRef.current
        if (!el) return
        const sh = el.getBoundingClientRect().height
        const maxH = Math.max(PROBLEMS_MIN, Math.min(sh - 160, PROBLEMS_MAX))
        const delta = ev.clientY - startY
        const next = Math.max(PROBLEMS_MIN, Math.min(startH + delta, maxH))
        drag.lastH = next
        setProblemsHeight(next)
      }
      const onUp = () => {
        try {
          localStorage.setItem(LS_PROBLEMS_H, String(drag.lastH))
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [environment, problemsHeight],
  )

  useEffect(() => {
    let cancelled = false
    void ensureMissionMonacoShiki().then(() => {
      if (!cancelled) setMonacoReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadTree = useCallback(async () => {
    initialTreeSelectionDoneRef.current = false
    openFileBuffersRef.current.clear()
    setTreeLoading(true)
    setTreeErr(null)
    setTree(null)
    setSelectedRel(null)
    setFileContent('')
    setTexturePreview(null)
    setMeshPreview(null)
    setDirty(false)
    try {
      const res = await fetchMissionProjectTree(projectRoot)
      setTree(res.tree)
      setTruncated(Boolean(res.truncated))
      setExpanded(new Set(['']))
    } catch (e) {
      setTreeErr(e instanceof Error ? e.message : 'Failed to load file tree')
    } finally {
      setTreeLoading(false)
    }
  }, [projectRoot])

  const reloadTreeOnly = useCallback(async () => {
    try {
      const res = await fetchMissionProjectTree(projectRoot)
      setTree(res.tree)
      setTruncated(Boolean(res.truncated))
    } catch {
      /* keep existing tree */
    }
  }, [projectRoot])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  selectedRelRef.current = selectedRel
  fileContentRef.current = fileContent
  dirtyRef.current = dirty

  const toggle = useCallback((rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }, [])

  const closePathDialog = useCallback(() => {
    setPathDialog(null)
    setPathDialogInput('')
    setPathActionErr(null)
    setPathActionBusy(false)
  }, [])

  const beginNewFile = useCallback(
    (parentRel: string) => {
      if (disabled) return
      setExpanded((prev) => {
        if (!parentRel) return prev
        const next = new Set(prev)
        next.add(parentRel)
        return next
      })
      const newRel = parentRel ? `${parentRel}/__new__` : '__new__'
      setInlineEditState({
        rel: newRel,
        kind: 'file',
        mode: 'new-file',
        initialValue: '',
      })
    },
    [disabled],
  )

  const beginRenameFile = useCallback(
    (fileRel: string, currentName?: string) => {
      if (disabled) return
      if (dirty && selectedRelRef.current === fileRel) {
        setFileErr('Save your changes before renaming this file.')
        return
      }
      const name = currentName ?? fileBasename(fileRel)
      setInlineEditState({
        rel: fileRel,
        kind: 'file',
        mode: 'rename',
        initialValue: name,
      })
    },
    [disabled, dirty],
  )

  const [pendingOpenFile, setPendingOpenFile] = useState<string | null>(null)
  
  const handleInlineEditConfirm = useCallback(
    async (rel: string, newName: string, mode: 'rename' | 'new-file' | 'new-folder') => {
      if (!inlineEditState) return
      setInlineEditState(null)

      try {
        if (mode === 'rename') {
          const oldRel = rel
          const parent = parentDirRel(oldRel)
          const newRel = parent ? `${parent}/${newName}` : newName
          if (newRel === oldRel) return

          const fromAbs = joinProjectPath(projectRoot, oldRel)
          const toAbs = joinProjectPath(projectRoot, newRel)
          await Util.renameFile(fromAbs, toAbs)
          await reloadTreeOnly()

          const moved = openFileBuffersRef.current.get(oldRel)
          if (moved) {
            openFileBuffersRef.current.delete(oldRel)
            openFileBuffersRef.current.set(newRel, moved)
          }
          if (selectedRelRef.current === oldRel) {
            setSelectedRel(newRel)
          }
        } else if (mode === 'new-file') {
          const parentRel = rel === '__new__' ? '' : rel.replace('/__new__', '')
          const newRel = parentRel ? `${parentRel}/${newName}` : newName
          const abs = joinProjectPath(projectRoot, newRel)
          await Util.createFile(abs, '')
          await reloadTreeOnly()
          setExpanded((prev) => {
            const next = new Set(prev)
            for (const d of ancestorDirRelPathsForFile(newRel)) {
              next.add(d)
            }
            return next
          })
          setPendingOpenFile(newRel)
        }
      } catch (e) {
        setFileErr(e instanceof Error ? e.message : 'Operation failed.')
      }
    },
    [inlineEditState, projectRoot, reloadTreeOnly],
  )

  const handleInlineEditCancel = useCallback(() => {
    setInlineEditState(null)
  }, [])

  const handleDelete = useCallback(async (rel: string, kind: 'file' | 'dir') => {
    if (disabled) return
    if (kind === 'dir') {
      setFileErr('Deleting folders is not yet supported. Use File Explorer.')
      return
    }
    const abs = joinProjectPath(projectRoot, rel)
    try {
      await Util.deleteFile(abs)
      openFileBuffersRef.current.delete(rel)
      if (selectedRelRef.current === rel) {
        setSelectedRel(null)
        setFileContent('')
        setDirty(false)
      }
      await reloadTreeOnly()
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Could not delete')
    }
  }, [disabled, projectRoot, reloadTreeOnly])

  const handleRevealInExplorer = useCallback((rel: string) => {
    const abs = joinProjectPath(projectRoot, rel || '')
    void Util.runCommand(`explorer /select,${JSON.stringify(abs)}`)
  }, [projectRoot])

  const handleCopyPath = useCallback((rel: string) => {
    const abs = joinProjectPath(projectRoot, rel)
    void navigator.clipboard.writeText(abs)
  }, [projectRoot])

  const handleOpenVSCode = useCallback((rel: string) => {
    const abs = joinProjectPath(projectRoot, rel || '')
    void Util.runCommand(`code ${JSON.stringify(abs)}`)
  }, [projectRoot])

  const handleOpenCursor = useCallback((rel: string) => {
    const abs = joinProjectPath(projectRoot, rel || '')
    void Util.runCommand(`cursor ${JSON.stringify(abs)}`)
  }, [projectRoot])

  const handleDuplicate = useCallback((_rel: string) => {
    if (disabled) return
    setFileErr('Duplicate is not yet implemented.')
  }, [disabled])

  const beginNewFolder = useCallback(
    (_parentRel: string) => {
      if (disabled) return
      setFileErr('Creating folders is not yet supported. Use File Explorer.')
    },
    [disabled],
  )

  useEffect(() => {
    if (!pathDialog) return
    const id = requestAnimationFrame(() => {
      pathInputRef.current?.focus()
      pathInputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [pathDialog])

  useEffect(() => {
    if (!pathDialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closePathDialog()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathDialog, closePathDialog])

  const editorLanguage =
    selectedRel && useSyntaxHighlighting ? missionResourceLanguage(selectedRel) : 'plaintext'

  const openFile = useCallback(
    async (rel: string, focus?: { line?: number; column?: number }) => {
      if (rel === selectedRelRef.current) {
        if (focus?.line != null) {
          jumpTargetRef.current = { rel, line: focus.line, column: focus.column }
          setExpanded((prev) => {
            const next = new Set(prev)
            for (const dirRel of ancestorDirRelPathsForFile(rel)) {
              next.add(dirRel)
            }
            return next
          })
          setJumpNonce((n) => n + 1)
        }
        return
      }

      const prevRel = selectedRelRef.current
      if (prevRel && prevRel !== rel && !isPaaRel(prevRel) && !isP3dRel(prevRel)) {
        openFileBuffersRef.current.set(prevRel, {
          text: fileContentRef.current,
          dirty: dirtyRef.current,
        })
      }

      if (focus?.line != null) {
        jumpTargetRef.current = { rel, line: focus.line, column: focus.column }
      } else {
        jumpTargetRef.current = null
      }
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const dirRel of ancestorDirRelPathsForFile(rel)) {
          next.add(dirRel)
        }
        return next
      })
      lintSeqRef.current += 1
      const shell = monacoShellRef.current
      const m = shell?.editor.getModel()
      if (shell && m) {
        shell.monaco.editor.setModelMarkers(m, 'hemtt', [])
      }
      setLintDiagnostics([])
      setLintToolError(null)

      const paa = isPaaRel(rel)
      const p3d = isP3dRel(rel)

      if (!paa && !p3d) {
        const cached = openFileBuffersRef.current.get(rel)
        if (cached) {
          setSelectedRel(rel)
          setFileErr(null)
          setFileLoading(false)
          setFileContent(cached.text)
          originalContentRef.current = cached.dirty ? originalContentRef.current : cached.text
          setDirty(cached.dirty)
          setTexturePreview(null)
          setMeshPreview(null)
          return
        }
      }

      setSelectedRel(rel)
      setFileErr(null)
      setFileLoading(true)
      setDirty(false)
      setTexturePreview(null)
      setMeshPreview(null)
      const abs = joinProjectPath(projectRoot, rel)
      try {
        if (paa) {
          const r = await decodePaaFromPath(abs)
          if (r.ok === true) {
            setTexturePreview({ width: r.width, height: r.height, data: r.data })
            setFileContent('')
          } else {
            setFileContent('')
            setFileErr(r.error)
            return
          }
        } else if (p3d) {
          const r = await getP3dPreviewMeshFromPath(abs)
          if (r.ok === true) {
            setMeshPreview({
              positions: r.positions,
              indices: r.indices,
              normals: r.normals,
              uvs: r.uvs,
              textureNames: r.textureNames,
              modelDirectory: dirnameAbs(abs),
            })
            setFileContent('')
          } else {
            setFileContent('')
            setFileErr(r.error)
            return
          }
        } else {
          setFileContent('')
          const text = await Util.getFileContents(abs)
          originalContentRef.current = text
          setFileContent(text)
          openFileBuffersRef.current.set(rel, { text, dirty: false })
        }
      } catch (e) {
        setFileContent('')
        setTexturePreview(null)
        setMeshPreview(null)
        setFileErr(e instanceof Error ? e.message : 'Could not read file')
      } finally {
        setFileLoading(false)
      }
    },
    [projectRoot],
  )

  useEffect(() => {
    if (pendingOpenFile) {
      void openFile(pendingOpenFile)
      setPendingOpenFile(null)
    }
  }, [pendingOpenFile, openFile])

  const handleCloseTab = useCallback(
    (rel: string) => {
      const buf = openFileBuffersRef.current.get(rel)
      if (buf?.dirty) {
        return
      }
      openFileBuffersRef.current.delete(rel)
      setBufferVersion((v) => v + 1)
      if (selectedRel === rel) {
        const remaining = Array.from(openFileBuffersRef.current.keys()).filter(
          (r) => !isPaaRel(r) && !isP3dRel(r),
        )
        if (remaining.length > 0) {
          void openFile(remaining[remaining.length - 1])
        } else {
          setSelectedRel(null)
          setFileContent('')
          setDirty(false)
        }
      }
    },
    [selectedRel, openFile],
  )

  const confirmPathDialog = useCallback(async () => {
    if (!pathDialog || pathActionBusy) return
    const label = sanitizeFileLabel(pathDialogInput)
    if (!label) {
      setPathActionErr('Enter a valid file name.')
      return
    }
    setPathActionBusy(true)
    setPathActionErr(null)
    try {
      if (pathDialog.kind === 'new') {
        const rel = pathDialog.parentRel ? `${pathDialog.parentRel}/${label}` : label
        const abs = joinProjectPath(projectRoot, rel)
        await Util.createFile(abs, '')
        await reloadTreeOnly()
        setExpanded((prev) => {
          const next = new Set(prev)
          for (const d of ancestorDirRelPathsForFile(rel)) {
            next.add(d)
          }
          return next
        })
        closePathDialog()
        void openFile(rel)
        return
      }
      const oldRel = pathDialog.fileRel
      if (dirty && selectedRelRef.current === oldRel) {
        setPathActionErr('Save your changes before renaming this file.')
        return
      }
      const parent = parentDirRel(oldRel)
      const newRel = parent ? `${parent}/${label}` : label
      if (newRel === oldRel) {
        closePathDialog()
        return
      }
      const fromAbs = joinProjectPath(projectRoot, oldRel)
      const toAbs = joinProjectPath(projectRoot, newRel)
      await Util.renameFile(fromAbs, toAbs)
      await reloadTreeOnly()
      const moved = openFileBuffersRef.current.get(oldRel)
      if (moved) {
        openFileBuffersRef.current.delete(oldRel)
        openFileBuffersRef.current.set(newRel, moved)
      }
      if (selectedRelRef.current === oldRel) {
        setSelectedRel(newRel)
      }
      closePathDialog()
    } catch (e) {
      setPathActionErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setPathActionBusy(false)
    }
  }, [
    pathDialog,
    pathDialogInput,
    pathActionBusy,
    projectRoot,
    reloadTreeOnly,
    closePathDialog,
    openFile,
    dirty,
  ])

  useEffect(() => {
    if (fileLoading || !monacoReady || !selectedRel) return
    if (isPaaRel(selectedRel) || isP3dRel(selectedRel)) return
    const j = jumpTargetRef.current
    if (!j || j.rel !== selectedRel) return
    jumpTargetRef.current = null
    const shell = monacoShellRef.current
    if (!shell) return
    const line = Math.max(1, j.line)
    const col = Math.max(1, j.column ?? 1)
    const run = () => {
      shell.editor.setPosition({ lineNumber: line, column: col })
      shell.editor.revealLineInCenter(line)
      shell.editor.focus()
    }
    requestAnimationFrame(run)
  }, [selectedRel, fileLoading, monacoReady, fileContent, jumpNonce])

  const onMonacoMount: OnMount = useCallback((editor, monaco) => {
    monacoShellRef.current = { editor, monaco }
    setEditorReadyTick((n) => n + 1)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      setGoToOpen(false)
      setSearchPanelReplaceMode(false)
      if (searchPanelOpenRef.current) {
        setSearchPanelFocusTick((n) => n + 1)
      } else {
        setSearchPanelOpen(true)
      }
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
      setGoToOpen(false)
      setSearchPanelReplaceMode(true)
      if (searchPanelOpenRef.current) {
        setSearchPanelFocusTick((n) => n + 1)
      } else {
        setSearchPanelOpen(true)
      }
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
      setSearchPanelOpen(false)
      setGoToMode('line')
      setGoToOpen(true)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () => {
      setSearchPanelOpen(false)
      setGoToMode('symbol')
      setGoToOpen(true)
    })
  }, [])

  useEffect(() => {
    if (environment !== 'mod' || !selectedRel || fileLoading || disabled) return
    if (isPaaRel(selectedRel) || isP3dRel(selectedRel)) return
    if (lintDebounceRef.current) clearTimeout(lintDebounceRef.current)
    lintDebounceRef.current = setTimeout(() => {
      lintDebounceRef.current = null
      const seq = ++lintSeqRef.current
      void (async () => {
        setLintRunning(true)
        setLintToolError(null)
        try {
          if (dirty) {
            const abs = joinProjectPath(projectRoot, selectedRel)
            await Util.setFileContents(abs, fileContent)
            setDirty(false)
            openFileBuffersRef.current.set(selectedRel, { text: fileContent, dirty: false })
          }
          const res = await Util.lintModProjectHemtt(projectRoot)
          if (seq !== lintSeqRef.current) return
          if (res.code === 'hemtt_missing' || res.code === 'hemtt_failed') {
            setLintDiagnostics([])
            setLintToolError(res.error ?? 'Could not run project check.')
            applyHemttMarkers(monacoShellRef.current, projectRoot, selectedRel, [])
            return
          }
          setLintToolError(res.error && res.diagnostics.length === 0 ? res.error : null)
          setLintDiagnostics(res.diagnostics)
          applyHemttMarkers(monacoShellRef.current, projectRoot, selectedRel, res.diagnostics)
        } catch (e) {
          if (seq !== lintSeqRef.current) return
          setLintDiagnostics([])
          setLintToolError(e instanceof Error ? e.message : 'Check failed.')
          applyHemttMarkers(monacoShellRef.current, projectRoot, selectedRel, [])
        } finally {
          if (seq === lintSeqRef.current) setLintRunning(false)
        }
      })()
    }, 650)
    return () => {
      if (lintDebounceRef.current) clearTimeout(lintDebounceRef.current)
    }
  }, [environment, projectRoot, selectedRel, fileContent, fileLoading, disabled, dirty])

  useEffect(() => {
    if (environment !== 'mod') return
    if (selectedRel && (isPaaRel(selectedRel) || isP3dRel(selectedRel))) return
    applyHemttMarkers(monacoShellRef.current, projectRoot, selectedRel, lintDiagnostics)
  }, [environment, projectRoot, selectedRel, lintDiagnostics])

  useEffect(() => {
    if (environment === 'mod') return
    setLintDiagnostics([])
    setLintToolError(null)
    setLintRunning(false)
    const shell = monacoShellRef.current
    const m = shell?.editor.getModel()
    if (shell && m) {
      shell.monaco.editor.setModelMarkers(m, 'hemtt', [])
    }
  }, [environment])

  useEffect(() => {
    if (!tree || treeLoading || treeErr) return
    if (initialTreeSelectionDoneRef.current) return
    const first = firstFileRelDepthFirst(tree)
    if (!first) return
    initialTreeSelectionDoneRef.current = true
    setExpanded(new Set(ancestorDirRelPathsForFile(first)))
    void openFile(first)
  }, [tree, treeLoading, treeErr, openFile])

  const saveFile = useCallback(async (relToSave?: string) => {
    const rel = relToSave ?? selectedRel
    if (!rel) return
    if (isPaaRel(rel) || isP3dRel(rel)) return
    setSavingRel(rel)
    setFileErr(null)
    const abs = joinProjectPath(projectRoot, rel)
    try {
      const contentToSave = rel === selectedRel ? fileContent : openFileBuffersRef.current.get(rel)?.text ?? ''
      await Util.setFileContents(abs, contentToSave)
      if (rel === selectedRel) {
        originalContentRef.current = contentToSave
        setDirty(false)
      }
      openFileBuffersRef.current.set(rel, { text: contentToSave, dirty: false })
      setBufferVersion((v) => v + 1)
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Could not save file')
    } finally {
      setSavingRel(null)
    }
  }, [projectRoot, selectedRel, fileContent])

  if (treeLoading) {
    return (
      <div className="px-5 py-8 text-center">
        <div
          className="mx-auto mb-3.5 h-[3px] w-full max-w-[200px] rounded-full bg-gradient-to-r from-border via-accent to-border bg-[length:200%_100%]"
          style={{ animation: "mission-resource-shimmer 1.1s ease-in-out infinite" }}
        />
        <p className="m-0 text-[13px] text-muted">Scanning project folder…</p>
      </div>
    )
  }
  if (treeErr) {
    return (
      <div className="mission-edit-empty mission-edit-empty-error">
        <p className="mission-edit-empty-title">Could not load files</p>
        <p className="mission-edit-empty-text">{treeErr}</p>
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => void loadTree()}>
          Try again
        </button>
      </div>
    )
  }
  if (!tree) {
    return (
      <div className="mission-edit-empty">
        <p className="mission-edit-empty-title">Empty project</p>
        <p className="mission-edit-empty-text">No file tree was returned for this folder.</p>
      </div>
    )
  }

  return (
    <div className="box-border flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col">
      <div
        className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-row max-[720px]:flex-col"
        ref={layoutRef}
      >
        <aside
          className="flex min-h-0 min-w-0 max-w-full flex-col bg-subtle max-[720px]:max-h-[min(240px,40vh)] max-[720px]:min-h-0 max-[720px]:border-b"
          style={wideLayout ? { flex: `0 0 ${sidebarWidth}px`, width: sidebarWidth } : undefined}
        >
          {pathDialog ? (
            <div
              className="border-b border-border bg-surface px-3.5 py-3"
              role="dialog"
              aria-modal="true"
              aria-labelledby={pathDialogTitleId}
            >
              <p id={pathDialogTitleId} className="m-0 mb-2 text-[13px] font-semibold text-heading">
                {pathDialog.kind === 'new' ? 'New file' : 'Rename file'}
              </p>
              <label htmlFor={pathDialogFieldId} className="mb-1 block text-[11px] font-semibold text-muted">
                Name
              </label>
              <input
                ref={pathInputRef}
                id={pathDialogFieldId}
                type="text"
                className="field-input box-border mb-1.5 w-full"
                autoComplete="off"
                value={pathDialogInput}
                disabled={pathActionBusy}
                onChange={(e) => setPathDialogInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void confirmPathDialog()
                  }
                }}
              />
              {pathDialog.kind === 'new' && pathDialog.parentRel ? (
                <p className="m-0 mb-2 [word-break:break-all] text-[11px] text-muted">Folder: {pathDialog.parentRel}/</p>
              ) : null}
              {pathActionErr ? (
                <p className="form-banner form-banner-error m-0 mb-2" role="alert">
                  {pathActionErr}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pathActionBusy}
                  onClick={() => void confirmPathDialog()}
                >
                  {pathDialog.kind === 'new' ? 'Create' : 'Rename'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={pathActionBusy}
                  onClick={() => closePathDialog()}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {truncated ? (
            <p className="m-0 border-b border-border px-3.5 py-2 text-[11px] text-muted">Large tree truncated for performance.</p>
          ) : null}
          <div className="scrollbar-subtle min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto overscroll-y-contain py-1.5 pr-1 pb-2.5 pl-1 [-webkit-overflow-scrolling:touch]">
            <FileTree
              tree={tree}
              expanded={expanded}
              selectedRel={selectedRel}
              busyFileRel={
                fileLoading && selectedRel && (isPaaRel(selectedRel) || isP3dRel(selectedRel))
                  ? selectedRel
                  : null
              }
              onToggle={toggle}
              onSelectFile={(rel) => void openFile(rel)}
              onRequestNewFile={beginNewFile}
              onRequestNewFolder={beginNewFolder}
              onRequestRename={beginRenameFile}
              onRequestDuplicate={(rel) => void handleDuplicate(rel)}
              onRequestDelete={handleDelete}
              onCopyPath={handleCopyPath}
              onRevealInExplorer={handleRevealInExplorer}
              onOpenVSCode={handleOpenVSCode}
              onOpenCursor={handleOpenCursor}
              onRefresh={() => void loadTree()}
              disabled={disabled}
              inlineEditState={inlineEditState}
              onInlineEditConfirm={handleInlineEditConfirm}
              onInlineEditCancel={handleInlineEditCancel}
            />
          </div>
        </aside>
        {wideLayout ? (
          <button
            type="button"
            className="m-0 shrink-0 self-stretch border-0 bg-border p-0 [flex:0_0_1px] [touch-action:none] w-px cursor-col-resize hover:bg-accent focus:outline-none"
            aria-orientation="vertical"
            aria-label="Resize panels"
            onPointerDown={onSidebarResizePointerDown}
            style={{ touchAction: 'none' }}
          />
        ) : null}
        <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col bg-surface">
          <ScriptEditorTabs
            tabs={openTabs}
            activeRel={selectedRel}
            onSelectTab={(rel) => void openFile(rel)}
            onCloseTab={handleCloseTab}
            onSaveTab={(rel) => void saveFile(rel)}
            disabled={disabled}
            savingRel={savingRel}
            contextTitle={contextTitle}
            fullscreen={fullscreen}
            onFullscreenToggle={onFullscreenToggle}
            onClose={onClose}
          />
          {!selectedRel ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-8 text-center">
              <p className="m-0 text-[15px] font-semibold text-heading">Select a file</p>
              <p className="m-0 mt-1 max-w-[36ch] text-[13px] leading-normal text-muted">
                Choose a file in the tree to view or edit its contents.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
              {fileErr ? (
                <p className="form-banner form-banner-error m-0 mx-2 mt-2" role="alert">
                  {fileErr}
                </p>
              ) : null}
              <ScriptEditorSearchPanel
                open={searchPanelOpen}
                initialReplaceMode={searchPanelReplaceMode}
                onOpenChange={setSearchPanelOpen}
                getShell={getEditorShell}
                documentText={fileContent}
                editorReadyTick={editorReadyTick}
                fileTree={tree}
                readProjectFile={readProjectFile}
                onOpenFile={(rel, focus) => void openFile(rel, focus)}
                onDocumentChange={(newText) => {
                  setFileContent(newText)
                  setDirty(newText !== originalContentRef.current)
                }}
                disabled={disabled}
                focusTick={searchPanelFocusTick}
              />
              <ScriptEditorGoTo
                open={goToOpen}
                mode={goToMode}
                onOpenChange={setGoToOpen}
                getShell={getEditorShell}
                documentText={fileContent}
                disabled={disabled}
              />
              {fileLoading && selectedRel && (isPaaRel(selectedRel) || isP3dRel(selectedRel)) ? (
                <div className="px-3 py-6 text-center">
                  <div
                    className="mx-auto mb-3.5 h-[3px] w-full max-w-[200px] rounded-full bg-gradient-to-r from-border via-accent to-border bg-[length:200%_100%]"
                    style={{ animation: "mission-resource-shimmer 1.1s ease-in-out infinite" }}
                  />
                  <p className="m-0 text-[13px] text-muted">Loading preview…</p>
                </div>
              ) : selectedRel && isPaaRel(selectedRel) ? (
                texturePreview ? (
                  <div className="flex min-h-[200px] min-w-0 flex-1 flex-col">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col [flex:1_1_0]">
                      <ImagePreview
                        width={texturePreview.width}
                        height={texturePreview.height}
                        rgba={texturePreview.data}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center text-center">
                    <p className="m-0 max-w-[36ch] text-[13px] text-muted">
                      {fileErr ? 'Preview is not available for this file.' : '\u00a0'}
                    </p>
                  </div>
                )
              ) : selectedRel && isP3dRel(selectedRel) ? (
                meshPreview ? (
                  <div className="flex min-h-[280px] min-w-0 flex-1 flex-col">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col [flex:1_1_0]">
                      <P3dPreview
                        positions={meshPreview.positions}
                        indices={meshPreview.indices}
                        normals={meshPreview.normals}
                        uvs={meshPreview.uvs}
                        textureNames={meshPreview.textureNames}
                        modelDirectory={meshPreview.modelDirectory}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center text-center">
                    <p className="m-0 max-w-[36ch] text-[13px] text-muted">
                      {fileErr ? 'Preview is not available for this file.' : '\u00a0'}
                    </p>
                  </div>
                )
              ) : !monacoReady ? (
                <div className="px-3 py-6 text-center">
                  <div
                    className="mx-auto mb-3.5 h-[3px] w-full max-w-[200px] rounded-full bg-gradient-to-r from-border via-accent to-border bg-[length:200%_100%]"
                    style={{ animation: "mission-resource-shimmer 1.1s ease-in-out infinite" }}
                  />
                  <p className="m-0 text-[13px] text-muted">Preparing editor…</p>
                </div>
              ) : (
                <div
                  className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
                  ref={environment === 'mod' ? editorStackRef : undefined}
                >
                  <div className="flex min-h-[200px] min-w-0 flex-1 flex-col [flex:1_1_0]">
                    <div
                      className="mission-resource-monaco box-border flex h-full w-full max-w-full min-h-[200px] min-w-0 flex-1 flex-col overflow-hidden border-t border-border bg-subtle [resize:none] [&>div]:min-h-0 [&>div]:flex-1"
                      role="textbox"
                      aria-label="File contents"
                      aria-multiline
                    >
                      <Editor
                        height="100%"
                        theme={missionMonacoTheme}
                        language={editorLanguage}
                        value={fileContent}
                        onMount={onMonacoMount}
                        onChange={(v) => {
                          const newContent = v ?? ''
                          setFileContent(newContent)
                          setDirty(newContent !== originalContentRef.current)
                        }}
                        options={{
                          readOnly:
                            Boolean(disabled) ||
                            Boolean(
                              fileLoading &&
                                selectedRel &&
                                !isPaaRel(selectedRel) &&
                                !isP3dRel(selectedRel),
                            ),
                          minimap: { enabled: showMinimap },
                          folding: showFolding,
                          foldingStrategy: 'indentation',
                          showFoldingControls: showFolding ? 'always' : 'never',
                          fontSize: 12,
                          fontFamily: 'var(--font-mono), ui-monospace, monospace',
                          wordWrap: 'on',
                          tabSize: 2,
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          find: { seedSearchStringFromSelection: 'never' },
                          bracketPairColorization: { enabled: true },
                          matchBrackets: 'always',
                          autoClosingBrackets: 'always',
                          autoClosingQuotes: 'always',
                        }}
                      />
                    </div>
                  </div>
                  {environment === 'mod' ? (
                    <>
                      <button
                        type="button"
                        className="m-0 w-full shrink-0 [flex:0_0_6px] cursor-row-resize border-0 bg-transparent p-0 [touch-action:none] hover:bg-[rgba(9,105,218,0.08)] focus:outline-none focus:shadow-[var(--focus)] dark:hover:bg-[rgba(88,166,255,0.1)]"
                        aria-orientation="horizontal"
                        aria-label="Resize panels"
                        onPointerDown={onProblemsResizePointerDown}
                        style={{ touchAction: 'none' }}
                      />
                      <aside
                        className="flex min-h-0 max-h-none min-w-0 flex-col overflow-hidden [flex:0_1_auto] rounded-b-[var(--radius)] border-0 border-t border-border bg-subtle"
                        aria-label="Project check results"
                        style={{ flex: `0 0 ${problemsHeight}px` }}
                      >
                      <div className="flex items-center justify-between gap-2.5 border-b border-border px-3 py-2">
                        <span className="shrink-0 text-[10px] font-extrabold tracking-[0.12em] text-muted uppercase">Project check</span>
                        {lintRunning ? (
                          <span className="inline-flex text-muted">
                            <Spinner size="sm" color="var(--text-muted)" aria-label="Checking project" />
                          </span>
                        ) : null}
                      </div>
                      {lintToolError ? (
                        <div className="scrollbar-subtle m-0 max-h-[200px] overflow-auto overflow-x-auto bg-[color-mix(in_srgb,var(--danger)_6%,var(--bg-subtle))] px-3.5 py-2.5 text-xs leading-normal text-body" role="alert">
                          {lintToolError.split('\n').map((errLine, li) => {
                            const parsed = parseGccStyleDiagnosticLine(projectRoot, errLine)
                            const rel =
                              parsed?.file && parsed.line != null
                                ? relFromProjectRoot(projectRoot, parsed.file)
                                : null
                            const sevIdx =
                              rel && parsed?.line != null
                                ? /:\s*(error|warning|note|help)\s*:\s*/i.exec(errLine)?.index
                                : undefined
                            const locEnd =
                              rel && parsed?.line != null && sevIdx != null && sevIdx > 0
                                ? sevIdx
                                : null
                            const focusLine = parsed?.line
                            const focusCol = parsed?.column
                            return (
                              <Fragment key={li}>
                                {li > 0 ? <br /> : null}
                                {locEnd != null && rel && focusLine != null ? (
                                  <p className="m-0 break-words [overflow-wrap:anywhere]">
                                    <button
                                      type="button"
                                      className="cursor-pointer border-0 border-b border-dotted border-[color-mix(in_srgb,var(--accent)_50%,var(--text-muted))] bg-transparent p-0 font-mono text-[0.8rem] [text-align:inherit] [text-decoration:inherit] text-accent hover:enabled:border-b-accent hover:enabled:text-accent"
                                      onClick={() =>
                                        void openFile(rel, { line: focusLine, column: focusCol })
                                      }
                                    >
                                      {errLine.slice(0, locEnd)}
                                    </button>
                                    <span>{errLine.slice(locEnd)}</span>
                                  </p>
                                ) : (
                                  <p className="m-0 break-words [overflow-wrap:anywhere]">{errLine}</p>
                                )}
                              </Fragment>
                            )
                          })}
                        </div>
                      ) : null}
                      {!lintRunning && !lintToolError && lintDiagnostics.length === 0 ? (
                        <p className="m-0 p-2.5 text-center text-xs text-muted">No issues reported for this folder.</p>
                      ) : null}
                      {lintDiagnostics.length > 0 ? (
                        <ul className="scrollbar-subtle m-0 max-h-[min(200px,30vh)] list-none space-y-0 overflow-y-auto overflow-x-hidden p-0 [scrollbar-gutter:stable]">
                          {lintDiagnostics.map((d, i) => {
                            const rel = d.file ? relFromProjectRoot(projectRoot, d.file) : null
                            const loc =
                              d.line != null
                                ? `${d.line}${d.column != null ? `:${d.column}` : ''}`
                                : ''
                            const sev =
                              d.severity === "warning"
                                ? "warning"
                                : d.severity === "help" || d.severity === "info"
                                  ? "info"
                                  : "error"
                            const sevClass =
                              sev === "warning"
                                ? "border-amber-600/30 bg-amber-500/20 text-amber-800 dark:text-amber-200"
                                : sev === "info"
                                  ? "border-blue-600/30 bg-blue-500/20 text-blue-800 dark:text-blue-200"
                                  : "border-red-500/30 bg-red-500/20 text-red-800 dark:text-red-200"
                            return (
                              <li
                                key={`${d.file ?? ""}-${i}`}
                                className="mb-0 border-b border-border [margin-bottom:0] last:mb-0"
                              >
                                <button
                                  type="button"
                                  className="flex w-full min-w-0 flex-col items-stretch gap-0.5 border-0 bg-transparent p-1.5 text-left [cursor:pointer] [font:inherit] [text-align:left] transition-[background] duration-100 [color:var(--text-body)] hover:enabled:bg-app disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={!rel}
                                  onClick={() => {
                                    if (!rel) return
                                    void openFile(
                                      rel,
                                      d.line != null ? { line: d.line, column: d.column } : undefined,
                                    )
                                  }}
                                >
                                  <span
                                    className={`w-fit rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase [letter-spacing:0.04em] ${sevClass}`}
                                  >
                                    {d.severity === 'warning' ? 'Warning' : d.severity === 'help' || d.severity === 'info' ? 'Info' : 'Error'}
                                  </span>
                                  <span className="break-words text-[0.7rem] font-mono [color:var(--text-muted)] [overflow-wrap:anywhere] [word-break:break-all] sm:text-xs">
                                    {rel ? `${rel}${loc ? ` (${loc})` : ''}` : d.file ?? '—'}
                                  </span>
                                  <span className="min-w-0 break-words text-xs leading-snug [overflow-wrap:anywhere]">{d.message}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                      </aside>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
