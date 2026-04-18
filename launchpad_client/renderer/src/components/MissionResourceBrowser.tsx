import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFileCirclePlus, faPen } from '@fortawesome/free-solid-svg-icons'
import { decodePaaFromPath, fetchMissionProjectTree, getP3dPreviewMeshFromPath, type ProjectTreeNode } from '../api/launchpad'
import { ImagePreview } from './ImagePreview.tsx'
import { P3dPreview } from './P3dPreview.tsx'
import { Spinner } from './Spinner'
import { useAppPreferences } from '../context/AppPreferencesContext'
import {
  ensureMissionMonacoShiki,
  missionMonacoTheme,
  missionResourceLanguage,
} from '../missionMonacoSetup'
import Util, { type HemttDiagnostic } from '../Util'

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

function formatSize(n: number | null | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function parentDirRel(relPosix: string): string {
  const parts = relPosix.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function fileBasename(relPosix: string): string {
  const parts = relPosix.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : relPosix
}

function isPaaRel(relPosix: string): boolean {
  return fileBasename(relPosix).toLowerCase().endsWith('.paa')
}

function isP3dRel(relPosix: string): boolean {
  return fileBasename(relPosix).toLowerCase().endsWith('.p3d')
}

/** Single path segment only (no folders in the name field). */
function sanitizeFileLabel(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (t.includes('/') || t.includes('\\')) return null
  if (t === '.' || t === '..') return null
  if (t.includes('\0')) return null
  return t
}

/** Depth-first: first file node in the same order as the tree UI. */
function firstFileRelDepthFirst(node: ProjectTreeNode): string | null {
  if (node.kind === 'file') return node.relPath || null
  for (const ch of node.children ?? []) {
    const hit = firstFileRelDepthFirst(ch)
    if (hit) return hit
  }
  return null
}

/** Directory ``relPath`` values that must be expanded to reveal a file at ``fileRel``. */
function ancestorDirRelPathsForFile(fileRel: string): string[] {
  const parts = fileRel.split('/').filter(Boolean)
  if (parts.length <= 1) return ['']
  const out: string[] = ['']
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(0, i + 1).join('/'))
  }
  return out
}

function TreeBranch({
  node,
  depth,
  expanded,
  toggle,
  selectedRel,
  busyFileRel,
  onSelectFile,
  disabled,
  onRequestNewFile,
  onRequestRename,
}: {
  node: ProjectTreeNode
  depth: number
  expanded: Set<string>
  toggle: (rel: string) => void
  selectedRel: string | null
  /** When set, show a small spinner on that file row (e.g. while a texture preview is loading). */
  busyFileRel: string | null
  onSelectFile: (rel: string) => void
  disabled?: boolean
  onRequestNewFile: (dirRel: string) => void
  onRequestRename: (fileRel: string) => void
}) {
  const isDir = node.kind === 'dir'
  const rel = node.relPath
  const open = isDir ? expanded.has(rel) : false

  return (
    <li
      className={`mission-tree-item${isDir && open ? ' is-expanded' : ''}`}
      style={{ paddingLeft: depth <= 2 ? depth * 8 : 16 + (depth - 2) * 2 }}
    >
      {isDir ? (
        <div className="mission-tree-line">
          <button
            type="button"
            className="mission-tree-row mission-tree-row-dir mission-tree-row-main"
            onClick={() => toggle(rel)}
            aria-expanded={open}
          >
            <span className="mission-tree-toggle" aria-hidden />
            <span className="mission-tree-icon mission-tree-icon-folder" aria-hidden />
            <span className="mission-tree-name">{node.name}</span>
            {node.truncated ? <span className="mission-tree-meta">…</span> : null}
          </button>
          {!disabled ? (
            <button
              type="button"
              className="mission-tree-row-tool btn btn-ghost btn-sm"
              aria-label="Add file in this folder"
              onClick={() => onRequestNewFile(rel)}
            >
              <FontAwesomeIcon icon={faFileCirclePlus} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mission-tree-line">
          <button
            type="button"
            className={`mission-tree-row mission-tree-row-file mission-tree-row-main${selectedRel === rel ? ' is-selected' : ''}`}
            onClick={() => onSelectFile(rel)}
          >
            <span className="mission-tree-toggle mission-tree-toggle-spacer" aria-hidden />
            <span className="mission-tree-icon mission-tree-icon-file" aria-hidden />
            <span className="mission-tree-name">{node.name}</span>
            {busyFileRel === rel ? (
              <span className="mission-tree-busy" aria-hidden>
                <Spinner size={14} color="var(--text-muted)" />
              </span>
            ) : null}
            {node.size != null ? <span className="mission-tree-meta">{formatSize(node.size)}</span> : null}
          </button>
          {!disabled ? (
            <button
              type="button"
              className="mission-tree-row-tool btn btn-ghost btn-sm"
              aria-label="Rename this file"
              onClick={() => onRequestRename(rel)}
            >
              <FontAwesomeIcon icon={faPen} />
            </button>
          ) : null}
        </div>
      )}
      {isDir && open && node.children?.length ? (
        <ul className="mission-tree-list mission-tree-nested">
          {node.children.map((ch) => (
            <TreeBranch
              key={ch.relPath || ch.name}
              node={ch}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              selectedRel={selectedRel}
              busyFileRel={busyFileRel}
              onSelectFile={onSelectFile}
              disabled={disabled}
              onRequestNewFile={onRequestNewFile}
              onRequestRename={onRequestRename}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

type Props = {
  projectRoot: string
  disabled?: boolean
  /** ``mod`` enables HEMTT project checks and a problems list; ``mission`` keeps editor-only behaviour. */
  environment?: ScriptEditorEnvironment
}

export function MissionResourceBrowser({ projectRoot, disabled, environment = 'mission' }: Props) {
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
  const [savingFile, setSavingFile] = useState(false)
  const [monacoReady, setMonacoReady] = useState(false)
  const [lintDiagnostics, setLintDiagnostics] = useState<HemttDiagnostic[]>([])
  const [lintRunning, setLintRunning] = useState(false)
  const [lintToolError, setLintToolError] = useState<string | null>(null)
  const monacoShellRef = useRef<{ editor: Parameters<OnMount>[0]; monaco: Parameters<OnMount>[1] } | null>(null)
  const lintDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lintSeqRef = useRef(0)
  const selectedRelRef = useRef<string | null>(null)
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
      setPathActionErr(null)
      setPathDialog({ kind: 'new', parentRel })
      setPathDialogInput('')
    },
    [disabled],
  )

  const beginRenameFile = useCallback(
    (fileRel: string) => {
      if (disabled) return
      if (dirty && selectedRelRef.current === fileRel) {
        setFileErr('Save your changes before renaming this file.')
        return
      }
      setPathActionErr(null)
      setPathDialog({ kind: 'rename', fileRel })
      setPathDialogInput(fileBasename(fileRel))
    },
    [disabled, dirty],
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
      setSelectedRel(rel)
      setFileErr(null)
      setFileLoading(true)
      setDirty(false)
      setTexturePreview(null)
      setMeshPreview(null)
      const abs = joinProjectPath(projectRoot, rel)
      const paa = isPaaRel(rel)
      const p3d = isP3dRel(rel)
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
          const text = await Util.getFileContents(abs)
          setFileContent(text)
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

  async function saveFile() {
    if (!selectedRel) return
    if (isPaaRel(selectedRel) || isP3dRel(selectedRel)) return
    setSavingFile(true)
    setFileErr(null)
    const abs = joinProjectPath(projectRoot, selectedRel)
    try {
      await Util.setFileContents(abs, fileContent)
      setDirty(false)
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : 'Could not save file')
    } finally {
      setSavingFile(false)
    }
  }

  if (treeLoading) {
    return (
      <div className="mission-resource-loading">
        <div className="mission-resource-loading-bar" />
        <p className="mission-resource-loading-text">Scanning project folder…</p>
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
    <div className="mission-resource-browser">
      <div className="mission-resource-layout">
        <aside className="mission-resource-sidebar">
          <div className="mission-resource-sidebar-head">
            <span className="mission-resource-sidebar-title">Files</span>
            <div className="mission-resource-sidebar-tools">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => beginNewFile(selectedRel ? parentDirRel(selectedRel) : '')}
              >
                New file
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => void loadTree()}>
                Refresh
              </button>
            </div>
          </div>
          {pathDialog ? (
            <div
              className="mission-resource-path-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby={pathDialogTitleId}
            >
              <p id={pathDialogTitleId} className="mission-resource-path-sheet-title">
                {pathDialog.kind === 'new' ? 'New file' : 'Rename file'}
              </p>
              <label htmlFor={pathDialogFieldId} className="mission-resource-path-sheet-label">
                Name
              </label>
              <input
                ref={pathInputRef}
                id={pathDialogFieldId}
                type="text"
                className="field-input mission-resource-path-sheet-input"
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
                <p className="mission-resource-path-sheet-hint">Folder: {pathDialog.parentRel}/</p>
              ) : null}
              {pathActionErr ? (
                <p className="form-banner form-banner-error mission-resource-path-sheet-err" role="alert">
                  {pathActionErr}
                </p>
              ) : null}
              <div className="mission-resource-path-sheet-actions">
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
            <p className="mission-resource-truncate-note">Large tree truncated for performance.</p>
          ) : null}
          <div className="mission-resource-tree-wrap">
            <ul className="mission-tree-list mission-tree-root">
              <TreeBranch
                node={tree}
                depth={0}
                expanded={expanded}
                toggle={toggle}
                selectedRel={selectedRel}
                busyFileRel={
                  fileLoading && selectedRel && (isPaaRel(selectedRel) || isP3dRel(selectedRel))
                    ? selectedRel
                    : null
                }
                onSelectFile={(rel) => void openFile(rel)}
                disabled={disabled}
                onRequestNewFile={beginNewFile}
                onRequestRename={beginRenameFile}
              />
            </ul>
          </div>
        </aside>
        <section className="mission-resource-editor">
          <div className="mission-resource-editor-head">
            <h3 className="mission-resource-editor-title">Editor</h3>
          </div>
          {!selectedRel ? (
            <div className="mission-resource-placeholder">
              <p className="mission-resource-placeholder-title">Select a file</p>
              <p className="mission-resource-placeholder-text">Choose a file in the tree to view or edit its contents.</p>
            </div>
          ) : (
            <div
              className={`mission-resource-editor-body${environment === 'mod' ? ' mission-resource-editor-body-mod' : ''}`}
            >
              <div className="mission-resource-file-toolbar">
                <code className="mission-resource-path">{selectedRel}</code>
                <div className="mission-resource-file-toolbar-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={disabled || fileLoading}
                    onClick={() => beginRenameFile(selectedRel)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={
                      disabled ||
                      savingFile ||
                      fileLoading ||
                      !dirty ||
                      texturePreview != null ||
                      meshPreview != null
                    }
                    onClick={() => void saveFile()}
                  >
                    {savingFile ? 'Saving…' : 'Save file'}
                  </button>
                </div>
              </div>
              {fileErr ? (
                <p className="form-banner form-banner-error mission-resource-file-err" role="alert">
                  {fileErr}
                </p>
              ) : null}
              {fileLoading ? (
                <div className="mission-resource-loading mission-resource-loading-inline">
                  <div className="mission-resource-loading-bar" />
                  <p className="mission-resource-loading-text">
                    {selectedRel && (isPaaRel(selectedRel) || isP3dRel(selectedRel))
                      ? 'Loading preview…'
                      : 'Loading file…'}
                  </p>
                </div>
              ) : selectedRel && isPaaRel(selectedRel) ? (
                texturePreview ? (
                  <div className="mission-resource-editor-editor-stack mission-resource-editor-editor-stack--image">
                    <ImagePreview
                      width={texturePreview.width}
                      height={texturePreview.height}
                      rgba={texturePreview.data}
                    />
                  </div>
                ) : (
                  <div className="mission-resource-placeholder mission-resource-preview-fallback">
                    <p className="mission-resource-placeholder-text">
                      {fileErr ? 'Preview is not available for this file.' : '\u00a0'}
                    </p>
                  </div>
                )
              ) : selectedRel && isP3dRel(selectedRel) ? (
                meshPreview ? (
                  <div className="mission-resource-editor-editor-stack mission-resource-editor-editor-stack--mesh">
                    <P3dPreview
                      positions={meshPreview.positions}
                      indices={meshPreview.indices}
                      normals={meshPreview.normals}
                      uvs={meshPreview.uvs}
                      textureNames={meshPreview.textureNames}
                      modelDirectory={meshPreview.modelDirectory}
                    />
                  </div>
                ) : (
                  <div className="mission-resource-placeholder mission-resource-preview-fallback">
                    <p className="mission-resource-placeholder-text">
                      {fileErr ? 'Preview is not available for this file.' : '\u00a0'}
                    </p>
                  </div>
                )
              ) : !monacoReady ? (
                <div className="mission-resource-loading mission-resource-loading-inline">
                  <div className="mission-resource-loading-bar" />
                  <p className="mission-resource-loading-text">Preparing editor…</p>
                </div>
              ) : (
                <div className="mission-resource-editor-editor-stack">
                  <div className="mission-resource-monaco" role="textbox" aria-label="File contents" aria-multiline>
                    <Editor
                      height="100%"
                      theme={missionMonacoTheme}
                      language={editorLanguage}
                      value={fileContent}
                      onMount={onMonacoMount}
                      onChange={(v) => {
                        setFileContent(v ?? '')
                        setDirty(true)
                      }}
                      options={{
                        readOnly: Boolean(disabled),
                        minimap: { enabled: false },
                        fontSize: 12,
                        fontFamily: 'var(--font-mono), ui-monospace, monospace',
                        wordWrap: 'on',
                        tabSize: 2,
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                      }}
                    />
                  </div>
                  {environment === 'mod' ? (
                    <aside className="mission-resource-problems" aria-label="Project check results">
                      <div className="mission-resource-problems-head">
                        <span className="mission-resource-problems-title">Project check</span>
                        {lintRunning ? (
                          <span className="mission-resource-problems-status mission-resource-problems-status-busy">
                            <Spinner size="sm" color="var(--text-muted)" aria-label="Checking project" />
                          </span>
                        ) : null}
                      </div>
                      {lintToolError ? (
                        <div className="mission-resource-problems-banner" role="alert">
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
                                  <p className="mission-resource-problems-banner-line">
                                    <button
                                      type="button"
                                      className="mission-resource-problems-banner-link"
                                      onClick={() =>
                                        void openFile(rel, { line: focusLine, column: focusCol })
                                      }
                                    >
                                      {errLine.slice(0, locEnd)}
                                    </button>
                                    <span>{errLine.slice(locEnd)}</span>
                                  </p>
                                ) : (
                                  <p className="mission-resource-problems-banner-line">{errLine}</p>
                                )}
                              </Fragment>
                            )
                          })}
                        </div>
                      ) : null}
                      {!lintRunning && !lintToolError && lintDiagnostics.length === 0 ? (
                        <p className="mission-resource-problems-empty">No issues reported for this folder.</p>
                      ) : null}
                      {lintDiagnostics.length > 0 ? (
                        <ul className="mission-resource-problems-list">
                          {lintDiagnostics.map((d, i) => {
                            const rel = d.file ? relFromProjectRoot(projectRoot, d.file) : null
                            const loc =
                              d.line != null
                                ? `${d.line}${d.column != null ? `:${d.column}` : ''}`
                                : ''
                            return (
                              <li key={`${d.file ?? ''}-${i}`} className="mission-resource-problems-item">
                                <button
                                  type="button"
                                  className="mission-resource-problems-row"
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
                                    className={`mission-resource-problems-sev mission-resource-problems-sev-${d.severity === 'warning' ? 'warning' : d.severity === 'help' || d.severity === 'info' ? 'info' : 'error'}`}
                                  >
                                    {d.severity === 'warning' ? 'Warning' : d.severity === 'help' || d.severity === 'info' ? 'Info' : 'Error'}
                                  </span>
                                  <span className="mission-resource-problems-meta">
                                    {rel ? `${rel}${loc ? ` (${loc})` : ''}` : d.file ?? '—'}
                                  </span>
                                  <span className="mission-resource-problems-msg">{d.message}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                    </aside>
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
