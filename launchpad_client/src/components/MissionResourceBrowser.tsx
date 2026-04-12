import { useCallback, useEffect, useState } from 'react'
import { fetchMissionProjectTree, type ProjectTreeNode } from '../api/launchpad'
import Util from '../Util'

function joinProjectPath(root: string, relPosix: string): string {
  const base = root.replace(/[/\\]+$/, '')
  if (!relPosix) return base
  const win = root.includes('\\')
  const parts = relPosix.split('/').filter(Boolean)
  return win ? [base, ...parts].join('\\') : [base, ...parts].join('/')
}

function formatSize(n: number | null | undefined): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
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
    <li className={`mission-tree-item${isDir && open ? ' is-expanded' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}>
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
}

export function MissionResourceBrowser({ projectRoot, disabled }: Props) {
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

  const loadTree = useCallback(async () => {
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

  const toggle = useCallback((rel: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
  }, [])

  const openFile = useCallback(
    async (rel: string) => {
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
            <div className="mission-resource-editor-body">
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
              {fileLoading ? (
                <div className="mission-resource-loading mission-resource-loading-inline">
                  <div className="mission-resource-loading-bar" />
                  <p className="mission-resource-loading-text">Loading file…</p>
                </div>
              ) : (
                <textarea
                  className="mission-resource-file-editor"
                  value={fileContent}
                  onChange={(ev) => {
                    setFileContent(ev.target.value)
                    setDirty(true)
                  }}
                  disabled={disabled || fileLoading}
                  spellCheck={false}
                  aria-label="File contents"
                />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
