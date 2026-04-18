import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import { fetchMissionProjectTree, type ProjectTreeNode } from '../api/launchpad'
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
  onSelectFile,
}: {
  node: ProjectTreeNode
  depth: number
  expanded: Set<string>
  toggle: (rel: string) => void
  selectedRel: string | null
  onSelectFile: (rel: string) => void
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
        <button
          type="button"
          className="mission-tree-row mission-tree-row-dir"
          onClick={() => toggle(rel)}
          aria-expanded={open}
        >
          <span className="mission-tree-toggle" aria-hidden />
          <span className="mission-tree-icon mission-tree-icon-folder" aria-hidden />
          <span className="mission-tree-name">{node.name}</span>
          {node.truncated ? <span className="mission-tree-meta">…</span> : null}
        </button>
      ) : (
        <button
          type="button"
          className={`mission-tree-row mission-tree-row-file${selectedRel === rel ? ' is-selected' : ''}`}
          onClick={() => onSelectFile(rel)}
        >
          <span className="mission-tree-toggle mission-tree-toggle-spacer" aria-hidden />
          <span className="mission-tree-icon mission-tree-icon-file" aria-hidden />
          <span className="mission-tree-name">{node.name}</span>
          {node.size != null ? <span className="mission-tree-meta">{formatSize(node.size)}</span> : null}
        </button>
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
              onSelectFile={onSelectFile}
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

  const editorLanguage =
    selectedRel && useSyntaxHighlighting ? missionResourceLanguage(selectedRel) : 'plaintext'

  const openFile = useCallback(
    async (rel: string) => {
      if (rel === selectedRelRef.current) {
        return
      }
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
      const abs = joinProjectPath(projectRoot, rel)
      try {
        const text = await Util.getFileContents(abs)
        setFileContent(text)
      } catch (e) {
        setFileContent('')
        setFileErr(e instanceof Error ? e.message : 'Could not read file')
      } finally {
        setFileLoading(false)
      }
    },
    [projectRoot],
  )

  const onMonacoMount: OnMount = useCallback((editor, monaco) => {
    monacoShellRef.current = { editor, monaco }
  }, [])

  useEffect(() => {
    if (environment !== 'mod' || !selectedRel || fileLoading || disabled) return
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
            <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => void loadTree()}>
              Refresh
            </button>
          </div>
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
                onSelectFile={(rel) => void openFile(rel)}
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
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={disabled || savingFile || fileLoading || !dirty}
                  onClick={() => void saveFile()}
                >
                  {savingFile ? 'Saving…' : 'Save file'}
                </button>
              </div>
              {fileErr ? (
                <p className="form-banner form-banner-error mission-resource-file-err" role="alert">
                  {fileErr}
                </p>
              ) : null}
              {fileLoading || !monacoReady ? (
                <div className="mission-resource-loading mission-resource-loading-inline">
                  <div className="mission-resource-loading-bar" />
                  <p className="mission-resource-loading-text">
                    {!monacoReady ? 'Preparing editor…' : 'Loading file…'}
                  </p>
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
                        {lintRunning ? <span className="mission-resource-problems-status">Working…</span> : null}
                      </div>
                      {lintToolError ? (
                        <p className="mission-resource-problems-banner" role="alert">
                          {lintToolError}
                        </p>
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
                                    if (rel) void openFile(rel)
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
