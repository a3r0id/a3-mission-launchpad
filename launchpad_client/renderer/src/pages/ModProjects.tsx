import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createManagedModProject,
  deleteManagedModProject,
  fetchManagedModProjects,
  updateManagedModProject,
  type ManagedModProject,
} from '../api/launchpad'
import Util from '../utils'
import { ScriptEditorModal } from '../components/Editor/IntegratedScriptEditor'
import {
  MissionSearchBar,
  MissionListStats,
  ModProjectListTable,
  CreateModProjectModal,
  useModProjectListPreferences,
  type ModProjectTableColumnId,
} from '../components/MissionList'

type SortDir = 'asc' | 'desc'

export function ModProjectsPage() {
  const [projects, setProjects] = useState<ManagedModProject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveInfo, setSaveInfo] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)

  const [editProject, setEditProject] = useState<ManagedModProject | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ManagedModProject | null>(null)
  const [scriptEditor, setScriptEditor] = useState<{ root: string; title: string } | null>(null)
  const [deleteRemoveDisk, setDeleteRemoveDisk] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const [sortField, setSortField] = useState<ModProjectTableColumnId>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [searchQuery, setSearchQuery] = useState('')
  const { favoriteIds, toggleFavorite, columnWidths, setColumnWidth } = useModProjectListPreferences()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await fetchManagedModProjects()
      setProjects(list)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load mod projects')
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase().trim()
    return projects.filter((p) => {
      const name = (p.name ?? '').toLowerCase()
      const desc = (p.description ?? '').toLowerCase()
      const path = (p.project_path ?? '').toLowerCase()
      return name.includes(q) || desc.includes(q) || path.includes(q)
    })
  }, [projects, searchQuery])

  function hasFolderPath(p: ManagedModProject) {
    return Boolean(p.project_path?.trim())
  }

  const sortedProjects = useMemo(() => {
    const copy = [...filteredProjects]
    copy.sort((a, b) => {
      const fa = favoriteIds.has(a.id)
      const fb = favoriteIds.has(b.id)
      if (fa !== fb) return fa ? -1 : 1
      let aVal = ''
      let bVal = ''
      switch (sortField) {
        case 'name':
          aVal = (a.name ?? '').toLowerCase()
          bVal = (b.name ?? '').toLowerCase()
          break
        case 'description':
          aVal = (a.description ?? '').toLowerCase()
          bVal = (b.description ?? '').toLowerCase()
          break
        case 'folder':
          aVal = hasFolderPath(a) ? '1' : '0'
          bVal = hasFolderPath(b) ? '1' : '0'
          break
      }
      const cmp = aVal.localeCompare(bVal)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filteredProjects, sortField, sortDir, favoriteIds])

  function handleSort(field: ModProjectTableColumnId) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function openFolder(p: ManagedModProject) {
    setActionErr(null)
    void Util.revealPathInExplorer(p.project_path ?? '', p.project_path ?? '').catch((e) =>
      setActionErr(e instanceof Error ? e.message : 'Could not open folder'),
    )
  }

  function addStarterForProject(p: ManagedModProject) {
    const root = p.project_path?.trim()
    if (!root) return
    setActionErr(null)
    void (async () => {
      const init = await Util.initModProjectHemtt(root, {
        name: (p.name ?? '').trim() || undefined,
      })
      if (!init.ok) {
        setActionErr(init.error ?? 'Could not add starter build files.')
        return
      }
      setSaveInfo(
        init.initialized === false ? 'Starter build files were already present.' : 'Starter build files are ready.',
      )
    })()
  }

  async function handleCreate(data: { name: string; description: string }) {
    try {
      const res = await createManagedModProject({
        name: data.name,
        description: data.description,
      })
      if ('error' in res && res.error) {
        setActionErr(res.error)
        setCreateOpen(false)
        return
      }
      if (!('ok' in res) || !res.ok) {
        setActionErr('Create failed.')
        setCreateOpen(false)
        return
      }

      const root = res.project.project_path?.trim() ?? ''
      if (root) {
        const init = await Util.initModProjectHemtt(root, { name: data.name })
        if (!init.ok) {
          const needsDesktop =
            typeof init.error === 'string' &&
            init.error.includes('requires the Launchpad desktop')
          if (needsDesktop) {
            setCreateOpen(false)
            setSaveInfo(
              'Mod project created. Open this project in the desktop app to add starter build files to the folder.',
            )
            void load()
            return
          }
          try {
            await deleteManagedModProject(res.project.id, { deleteProjectFiles: true })
          } catch {
            /* rollback best effort */
          }
          setActionErr(init.error ?? 'Could not add starter build files. The new entry was removed.')
          setCreateOpen(false)
          return
        }
      }

      setCreateOpen(false)
      setSaveInfo('Mod project created with starter build files in the folder.')
      void load()
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Create failed')
      setCreateOpen(false)
    }
  }

  function openEdit(p: ManagedModProject) {
    setEditProject(p)
    setEditName((p.name ?? '').trim())
    setEditDescription((p.description ?? '').trim())
    setEditErr(null)
  }

  async function submitEdit() {
    if (!editProject) return
    setEditBusy(true)
    setEditErr(null)
    try {
      const res = await updateManagedModProject(editProject.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      })
      if ('error' in res && res.error) {
        setEditErr(res.error)
        return
      }
      if ('ok' in res && res.ok) {
        setEditProject(res.project)
        setSaveInfo('Mod project updated.')
        void load()
      }
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setEditBusy(false)
    }
  }

  function openDelete(p: ManagedModProject) {
    setDeleteErr(null)
    setDeleteRemoveDisk(false)
    setDeleteTarget(p)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteErr(null)
    try {
      await deleteManagedModProject(deleteTarget.id, { deleteProjectFiles: deleteRemoveDisk })
      setDeleteTarget(null)
      setSaveInfo(deleteRemoveDisk ? 'Mod project removed and its folder was deleted.' : 'Mod project removed from Launchpad.')
      void load()
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="mission-page relative z-[1] flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <ScriptEditorModal
        open={scriptEditor !== null}
        projectRoot={scriptEditor?.root ?? ''}
        contextTitle={scriptEditor?.title ?? ''}
        environment="mod"
        onClose={() => setScriptEditor(null)}
      />

      {editProject ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="edit-mod-project-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => !editBusy && setEditProject(null)}
          />
          <div className="modal-dialog modal-dialog-wide mission-edit-dialog">
            <header className="mission-edit-header">
              <div className="mission-edit-header-main">
                <p className="mission-edit-eyebrow">Mod projects</p>
                <h2 id="edit-mod-project-title" className="mission-edit-title">
                  Edit mod project
                </h2>
              </div>
              <button
                type="button"
                className="mission-edit-close"
                onClick={() => !editBusy && setEditProject(null)}
                aria-label="Close"
                disabled={editBusy}
              >
                <span aria-hidden>×</span>
              </button>
            </header>
            <div className="mission-edit-surface">
              <div className="mission-edit-section">
                <p className="mission-edit-lead">
                  Changes here update what Launchpad shows. The folder on disk keeps its original name.
                </p>
                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    type="text"
                    className="field-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={editBusy}
                    autoComplete="off"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Description</span>
                  <input
                    type="text"
                    className="field-input"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={editBusy}
                    autoComplete="off"
                  />
                </label>
                {editErr ? (
                  <p className="form-banner form-banner-error" role="alert">
                    {editErr}
                  </p>
                ) : null}
              </div>
            </div>
            <footer className="mission-edit-footer">
              <div className="mission-edit-footer-actions">
                <button type="button" className="btn btn-primary" disabled={editBusy} onClick={() => void submitEdit()}>
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="btn btn-ghost" disabled={editBusy} onClick={() => setEditProject(null)}>
                  Close
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="delete-mod-project-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => !deleteBusy && setDeleteTarget(null)}
            disabled={deleteBusy}
          />
          <div className="modal-dialog">
            <h2 id="delete-mod-project-title" className="card-title">
              Remove mod project
            </h2>
            <p className="card-body" style={{ margin: 0, fontSize: 13 }}>
              Remove <strong>{(deleteTarget.name ?? '').trim() || 'this project'}</strong> from Launchpad.
              {deleteTarget.project_path?.trim() ? (
                <>
                  {' '}
                  You can also delete its project folder from your computer; that cannot be undone.
                </>
              ) : null}
            </p>
            {deleteTarget.project_path?.trim() ? (
              <label className="field" style={{ marginTop: 12 }}>
                <span className="field-label">
                  <input
                    type="checkbox"
                    checked={deleteRemoveDisk}
                    disabled={deleteBusy}
                    onChange={(e) => setDeleteRemoveDisk(e.target.checked)}
                  />{' '}
                  Also delete the project folder on disk
                </span>
              </label>
            ) : null}
            {deleteErr ? (
              <p className="form-banner form-banner-error" role="alert">
                {deleteErr}
              </p>
            ) : null}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-primary" disabled={deleteBusy} onClick={() => void confirmDelete()}>
                {deleteBusy ? 'Removing…' : 'Remove'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <header className="flex shrink-0 items-center justify-between gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="m-0 text-lg font-semibold text-heading">Mod projects</h1>
          <MissionSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search mod projects..."
            disabled={loading}
          />
          <MissionListStats
            total={projects.length}
            visible={sortedProjects.length}
            hasFilter={Boolean(searchQuery.trim())}
            itemSingular="mod project"
            itemPlural="mod projects"
          />
        </div>
        <div className="flex shrink-0 gap-2">
          {!createOpen && (
            <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              + New mod project
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {loadError ? (
        <p
          className="m-0 w-full rounded-none border-x-0 border-b border-t-0 border-danger/25 bg-danger-soft px-2.5 py-2 text-xs text-heading"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}
      {actionErr ? (
        <p
          className="m-0 w-full rounded-none border-x-0 border-b border-t-0 border-danger/25 bg-danger-soft px-2.5 py-2 text-xs text-heading"
          role="alert"
        >
          {actionErr}
        </p>
      ) : null}
      {saveInfo && !createOpen && !editProject && !deleteTarget ? (
        <p
          className="m-0 w-full rounded-none border-x-0 border border-b border-t-0 border-success/28 bg-success/12 px-2.5 py-2 text-xs text-heading"
          role="status"
        >
          {saveInfo}
        </p>
      ) : null}

      {loading ? (
        <p className="m-0 px-5 py-10 text-center text-sm text-muted">Loading…</p>
      ) : null}

      {!loading && projects.length === 0 && !loadError ? (
        <p className="m-0 px-5 py-10 text-center text-sm text-muted">No mod projects yet.</p>
      ) : null}

      {!loading && projects.length > 0 && sortedProjects.length === 0 ? (
        <p className="m-0 px-5 py-10 text-center text-sm text-muted">
          No mod projects match &quot;{searchQuery}&quot;
        </p>
      ) : null}

      {!loading && sortedProjects.length > 0 ? (
        <ModProjectListTable
          projects={sortedProjects}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          columnWidths={columnWidths}
          onResizeColumn={setColumnWidth}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          loading={loading}
          onEdit={openEdit}
          onOpenFolder={openFolder}
          onScriptEditor={(root, title) => setScriptEditor({ root, title })}
          onAddStarter={addStarterForProject}
          onRemove={openDelete}
        />
      ) : null}

      {createOpen && (
        <CreateModProjectModal
          onClose={() => setCreateOpen(false)}
          onCreated={(data) => void handleCreate(data)}
        />
      )}
    </div>
  )
}
