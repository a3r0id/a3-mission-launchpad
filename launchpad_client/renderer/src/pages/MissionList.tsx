import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGithub } from '@fortawesome/free-brands-svg-icons'
import { faEdit, faArchive, faTrash, faPlay, faList, faEllipsisVertical } from '@fortawesome/free-solid-svg-icons'
import {
  deleteManagedScenario,
  fetchManagedScenarios,
  fetchManagedScenarioMods,
  launchManagedScenario,
  saveManagedScenarioMods,
  type ManagedScenario,
  type MissionLaunchMod,
} from '../api/launchpad'
import { extractGameTypeFromDescriptionExt, missionDescriptionExtPath } from '../mission/descriptionExt'
import { MissionEditModal } from '../components/MissionEditModal'
import { ScriptEditorModal } from '../components/IntegratedScriptEditor'
import { MissionGitHubModal } from '../components/MissionGitHubModal'
import Util, { PboOutputExistsError } from '../Util'
import { VSCodeIcon } from '../components/CustomIcons/VSCodeIcon'
import { MissionBuildPage } from './MissionBuildPage'

function fullMissionName(s: ManagedScenario) {
  const base = (s.name ?? '').trim()
  const suf = (s.map_suffix ?? '').trim()
  if (!base && !suf) return '—'
  return `${base || '—'}.${suf || '—'}`
}

function hasSymlinkPaths(s: ManagedScenario) {
  return Boolean(
    typeof s.project_path === 'string' &&
      s.project_path.trim() &&
      typeof s.profile_path === 'string' &&
      s.profile_path.trim(),
  )
}

function parentDir(projectPath: string) {
  const x = projectPath.replace(/[/\\]+$/, '')
  const i = Math.max(x.lastIndexOf('/'), x.lastIndexOf('\\'))
  return i === -1 ? '' : x.slice(0, i)
}

/** Parent of the mission folder + `output` (for Launchpad missions, that is `.../mission_projects/output`). */
function defaultPboOutputFolder(projectPath: string | undefined): string {
  const p = (projectPath ?? '').trim()
  if (!p) return ''
  const root = parentDir(p)
  if (!root) return ''
  const sep = /\\/.test(p) && !/\//.test(p) ? '\\' : '/'
  return `${root.replace(/[/\\]+$/, '')}${sep}output`
}

type MissionListPageProps = {
  onOpenSettings?: () => void
}

export function MissionListPage({ onOpenSettings }: MissionListPageProps) {
  const modlistFileInputId = useId()
  const modlistFileRef = useRef<HTMLInputElement>(null)
  const [scenarios, setScenarios] = useState<ManagedScenario[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editMission, setEditMission] = useState<ManagedScenario | null>(null)
  const [githubMission, setGithubMission] = useState<ManagedScenario | null>(null)
  const [saveInfo, setSaveInfo] = useState<string | null>(null)

  const [pboMission, setPboMission] = useState<ManagedScenario | null>(null)
  const [pboOutDir, setPboOutDir] = useState('')
  const [pboLogLines, setPboLogLines] = useState<string[]>([])
  const [pboBusy, setPboBusy] = useState(false)
  const [pboErr, setPboErr] = useState<string | null>(null)
  const [pboResultPath, setPboResultPath] = useState<string | null>(null)
  /** When set, a stacked dialog asks whether to replace this existing ``.pbo`` file. */
  const [pboOverwritePath, setPboOverwritePath] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ManagedScenario | null>(null)
  const [deleteRemoveDisk, setDeleteRemoveDisk] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const [modsMission, setModsMission] = useState<ManagedScenario | null>(null)
  const [modsRows, setModsRows] = useState<MissionLaunchMod[]>([])
  const [modsBusy, setModsBusy] = useState(false)
  const [modsErr, setModsErr] = useState<string | null>(null)
  const [modsInfo, setModsInfo] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [scriptEditor, setScriptEditor] = useState<{ root: string; title: string } | null>(null)
  const [missionMenuOpenId, setMissionMenuOpenId] = useState<string | null>(null)
  const [scenarioGameTypes, setScenarioGameTypes] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    async function loadGameTypes() {
      const next: Record<string, string> = {}
      await Promise.all(
        scenarios.map(async (s) => {
          const root = s.project_path?.trim()
          if (!root) {
            next[s.id] = ''
            return
          }
          try {
            const text = await Util.getFileContents(missionDescriptionExtPath(root))
            if (!cancelled) next[s.id] = extractGameTypeFromDescriptionExt(text)
          } catch {
            if (!cancelled) next[s.id] = ''
          }
        }),
      )
      if (!cancelled) setScenarioGameTypes(next)
    }
    void loadGameTypes()
    return () => {
      cancelled = true
    }
  }, [scenarios])

  useEffect(() => {
    if (!missionMenuOpenId) return
    const onDocMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (!el) return
      if (el.closest(`[data-mission-row-menu="${missionMenuOpenId}"]`)) return
      setMissionMenuOpenId(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [missionMenuOpenId])

  function openPboModal(s: ManagedScenario) {
    setPboMission(s)
    setPboOutDir(defaultPboOutputFolder(s.project_path))
    setPboLogLines([])
    setPboErr(null)
    setPboResultPath(null)
    setPboOverwritePath(null)
  }

  function closePboModal() {
    if (pboBusy) return
    setPboOverwritePath(null)
    setPboMission(null)
  }

  function openDeleteDialog(s: ManagedScenario) {
    setDeleteErr(null)
    setDeleteRemoveDisk(false)
    setDeleteTarget(s)
  }

  function closeDeleteDialog() {
    if (deleteBusy) return
    setDeleteTarget(null)
  }

  async function openModsDialog(s: ManagedScenario) {
    setModsMission(s)
    setModsErr(null)
    setModsInfo(null)
    setModsRows(Array.isArray(s.launch_mods) ? s.launch_mods : [])
    setModsBusy(true)
    try {
      const rows = await fetchManagedScenarioMods(s.id)
      setModsRows(rows)
    } catch (e) {
      setModsErr(e instanceof Error ? e.message : 'Could not load mission mod profile.')
    } finally {
      setModsBusy(false)
    }
  }

  function closeModsDialog() {
    if (modsBusy) return
    setModsMission(null)
    setModsErr(null)
    setModsInfo(null)
  }

  async function onModsHtmlFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file || !modsMission) return
    setModsBusy(true)
    setModsErr(null)
    setModsInfo(null)
    try {
      const text = await file.text()
      const parsed = await Util.parseModlistFromHtml(file.name, text)
      if (!parsed.mods.length) {
        setModsInfo('No mods were recognized in that HTML file.')
        return
      }
      const have = new Set(modsRows.map((m) => m.path.toLowerCase()))
      const additions: { path: string; enabled: boolean; label: string }[] = []
      for (const mod of parsed.mods) {
        const link = mod.link.trim()
        if (!link) continue
        const key = link.toLowerCase()
        if (!have.has(key)) {
          have.add(key)
          additions.push({ path: link, enabled: true, label: mod.name?.trim() ?? '' })
        }
      }
      const merged = [...modsRows.map((m) => ({ ...m })), ...additions]
      const saved = await saveManagedScenarioMods(modsMission.id, merged)
      setModsRows(saved)
      setScenarios((prev) => prev.map((x) => (x.id === modsMission.id ? { ...x, launch_mods: saved } : x)))
      setModsInfo(
        additions.length
          ? `Imported ${additions.length} new mod(s).`
          : 'All recognized mods were already saved for this mission.',
      )
    } catch (e) {
      setModsErr(e instanceof Error ? e.message : 'Could not import mod list.')
    } finally {
      setModsBusy(false)
    }
  }

  async function toggleMissionMod(id: string, enabled: boolean) {
    if (!modsMission) return
    setModsBusy(true)
    setModsErr(null)
    try {
      const merged = modsRows.map((m) => (m.id === id ? { ...m, enabled } : m))
      const saved = await saveManagedScenarioMods(modsMission.id, merged)
      setModsRows(saved)
      setScenarios((prev) => prev.map((x) => (x.id === modsMission.id ? { ...x, launch_mods: saved } : x)))
    } catch (e) {
      setModsErr(e instanceof Error ? e.message : 'Could not update mission mod profile.')
    } finally {
      setModsBusy(false)
    }
  }

  async function clearMissionMods() {
    if (!modsMission || modsRows.length === 0) return
    if (!window.confirm('Clear all saved mods for this mission?')) return
    setModsBusy(true)
    setModsErr(null)
    try {
      const saved = await saveManagedScenarioMods(modsMission.id, [])
      setModsRows(saved)
      setScenarios((prev) => prev.map((x) => (x.id === modsMission.id ? { ...x, launch_mods: saved } : x)))
      setModsInfo('Saved mod profile cleared for this mission.')
    } catch (e) {
      setModsErr(e instanceof Error ? e.message : 'Could not clear mission mod profile.')
    } finally {
      setModsBusy(false)
    }
  }

  async function runMission(scenario: ManagedScenario) {
    setSaveInfo(null)
    const res = await launchManagedScenario(scenario.id)
    if ('error' in res) {
      setLoadError(res.error)
      return
    }
    setLoadError(null)
    setSaveInfo(
      res.message ??
        `Started Arma 3 for ${fullMissionName(scenario)}${res.modsApplied ? ` with ${res.modsApplied} mod(s)` : ''}.`,
    )
  }

  async function confirmDeleteMission() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteErr(null)
    try {
      await deleteManagedScenario(deleteTarget.id, { deleteProjectFiles: deleteRemoveDisk })
      if (editMission?.id === deleteTarget.id) setEditMission(null)
      if (githubMission?.id === deleteTarget.id) setGithubMission(null)
      await load()
      setDeleteTarget(null)
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function runPboBuild(overwrite = false) {
    const mission = pboMission
    const proj = mission?.project_path?.trim()
    if (!mission || !proj) return
    setPboBusy(true)
    setPboErr(null)
    setPboLogLines([])
    setPboResultPath(null)
    setPboOverwritePath(null)
    try {
      await Util.buildMissionPBOStream(
        proj,
        pboOutDir.trim() || undefined,
        (ev) => {
          if (ev.type === 'log') {
            setPboLogLines((prev) => [...prev, ev.message])
          } else if (ev.type === 'error') {
            setPboErr(ev.message)
          } else if (ev.type === 'done') {
            setPboResultPath(ev.pboPath)
          }
        },
        {
          missionName: mission.name ?? '',
          mapSuffix: mission.map_suffix ?? '',
        },
        overwrite ? { overwrite: true } : undefined,
      )
    } catch (e) {
      if (e instanceof PboOutputExistsError) {
        setPboOverwritePath((e.pboPath ?? '').trim() || '—')
        return
      }
      setPboErr(e instanceof Error ? e.message : 'Build failed')
    } finally {
      setPboBusy(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await fetchManagedScenarios()
      setScenarios(list)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load missions')
      setScenarios([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page-stack">
      <ScriptEditorModal
        open={scriptEditor !== null}
        projectRoot={scriptEditor?.root ?? ''}
        contextTitle={scriptEditor?.title ?? ''}
        environment="mission"
        onClose={() => setScriptEditor(null)}
      />
      {createOpen ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="new-mission-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => setCreateOpen(false)}
          />
          <div className="modal-dialog modal-dialog-wide mission-edit-dialog">
            <header className="mission-edit-header">
              <div className="mission-edit-header-main">
                <p className="mission-edit-eyebrow">Create mission</p>
                <h2 id="new-mission-title" className="mission-edit-title">
                  New Mission
                </h2>
              </div>
              <button
                type="button"
                className="mission-edit-close"
                onClick={() => setCreateOpen(false)}
                aria-label="Close"
              >
                <span aria-hidden>×</span>
              </button>
            </header>
            <div className="mission-edit-surface">
              <MissionBuildPage
                embedded
                onGoSettings={onOpenSettings}
                onBuilt={(res) => {
                  setCreateOpen(false)
                  setSaveInfo(
                    `Mission created at ${res.mission_path ?? 'project folder'} (${res.mission_id ?? 'managed'}).`,
                  )
                  void load()
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
      {editMission ? (
        <MissionEditModal
          key={editMission.id}
          mission={editMission}
          onClose={() => setEditMission(null)}
          onMissionUpdated={(m) => setEditMission(m)}
          onSaved={() => {
            void load()
            setSaveInfo('Mission updated.')
          }}
        />
      ) : null}
      {githubMission ? (
        <MissionGitHubModal
          key={githubMission.id}
          mission={githubMission}
          onClose={() => setGithubMission(null)}
          onAfterCommit={() => void load()}
          onOpenSettings={
            onOpenSettings
              ? () => {
                  setGithubMission(null)
                  onOpenSettings()
                }
              : undefined
          }
        />
      ) : null}
      {modsMission ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="mods-modal-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => closeModsDialog()}
            disabled={modsBusy}
          />
          <div className="modal-dialog modal-dialog-wide mission-edit-dialog">
            <header className="mission-edit-header">
              <div className="mission-edit-header-main">
                <p className="mission-edit-eyebrow">Mission launch profile</p>
                <h2 id="mods-modal-title" className="mission-edit-title">
                  {fullMissionName(modsMission)}
                </h2>
              </div>
              <button
                type="button"
                className="mission-edit-close"
                onClick={() => closeModsDialog()}
                aria-label="Close"
                disabled={modsBusy}
              >
                <span aria-hidden>×</span>
              </button>
            </header>

            <div className="mission-edit-surface">
              <div className="mission-edit-section">
                <p className="mission-edit-lead">
                  Save a mod profile just for this mission. Launchpad applies these enabled mods whenever this mission
                  is started from Launchpad.
                </p>
                <div className="testing-toolbar" style={{ marginBottom: 8 }}>
                  <input
                    ref={modlistFileRef}
                    id={modlistFileInputId}
                    type="file"
                    accept=".html,.htm,text/html"
                    hidden
                    onChange={(e) => void onModsHtmlFile(e)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={modsBusy}
                    onClick={() => modlistFileRef.current?.click()}
                  >
                    Load HTML mod list…
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={modsBusy || !modsRows.length}
                    onClick={() => void clearMissionMods()}
                  >
                    Clear all mods
                  </button>
                </div>
                {modsInfo ? (
                  <p className="form-banner form-banner-success" role="status">
                    {modsInfo}
                  </p>
                ) : null}
                {modsErr ? (
                  <p className="form-banner form-banner-error" role="alert">
                    {modsErr}
                  </p>
                ) : null}
                {modsRows.length === 0 ? (
                  <p className="card-body" style={{ color: 'var(--text-muted)' }}>
                    No mods saved for this mission.
                  </p>
                ) : (
                  <div className="testing-mod-table-wrap">
                    <table className="testing-mod-table">
                      <thead>
                        <tr>
                          <th scope="col">On</th>
                          <th scope="col">Name</th>
                          <th scope="col">Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modsRows.map((m) => (
                          <tr key={m.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={m.enabled !== false}
                                disabled={modsBusy}
                                onChange={(e) => void toggleMissionMod(m.id, e.target.checked)}
                                aria-label={`Enable mod ${m.path}`}
                              />
                            </td>
                            <td>
                              {m.label?.trim() ? m.label : '—'}
                            </td>
                            <td>
                              <code className="testing-mod-path">{m.path}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {deleteTarget ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="delete-mission-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => closeDeleteDialog()}
            disabled={deleteBusy}
          />
          <div className="modal-dialog">
            <h2 id="delete-mission-title" className="card-title">
              Delete mission
            </h2>
            <p className="card-body" style={{ margin: 0, fontSize: 13 }}>
              Remove <strong>{fullMissionName(deleteTarget)}</strong> from Launchpad&apos;s managed list.
              {deleteTarget.project_path?.trim() ? (
                <>
                  {' '}
                  This does not delete files on disk unless you choose the option below.
                </>
              ) : (
                <> This mission has no project folder on record.</>
              )}
            </p>
            {deleteTarget.project_path?.trim() ? (
              <label className="modal-checkbox-field">
                <input
                  type="checkbox"
                  checked={deleteRemoveDisk}
                  onChange={(ev) => setDeleteRemoveDisk(ev.target.checked)}
                  disabled={deleteBusy}
                />
                <span>
                  Also delete the mission project folder from disk. Only folders under Launchpad&apos;s{' '}
                  <code className="shell-inline-code">mission_projects</code> directory can be removed this way.
                </span>
              </label>
            ) : null}
            {deleteErr ? (
              <p className="form-banner form-banner-error" role="alert">
                {deleteErr}
              </p>
            ) : null}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteMission()}
              >
                {deleteBusy ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={deleteBusy} onClick={() => closeDeleteDialog()}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pboMission ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="pbo-modal-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => closePboModal()}
            disabled={pboBusy}
          />
          <div className="modal-dialog modal-dialog-wide mission-edit-dialog pbo-build-dialog">
            <header className="mission-edit-header">
              <div className="mission-edit-header-main">
                <p className="mission-edit-eyebrow">Build mission PBO</p>
                <h2 id="pbo-modal-title" className="mission-edit-title">
                  {fullMissionName(pboMission)}
                </h2>
              </div>
              <button
                type="button"
                className="mission-edit-close"
                onClick={() => closePboModal()}
                aria-label="Close"
                disabled={pboBusy}
              >
                <span aria-hidden>×</span>
              </button>
            </header>

            <div className="mission-edit-surface">
              <div className="mission-edit-section pbo-build-section">
                <p className="mission-edit-lead pbo-build-lead">
                  Output file is always{' '}
                  <strong>
                    {fullMissionName(pboMission)}.pbo
                  </strong>
                  . By default the folder below is <code className="mission-edit-code">mission_projects/output</code>{' '}
                  (next to your mission folders). Clear it to write beside the mission folder, or set another parent
                  directory. You can paste a full path ending in <code className="mission-edit-code">.pbo</code> - only
                  the parent folder is used; the filename stays as above.
                </p>

                <label className="field">
                  <span className="field-label">Output folder (optional)</span>
                  <input
                    type="text"
                    className="field-input"
                    name="pbo_output"
                    autoComplete="off"
                    value={pboOutDir}
                    onChange={(ev) => setPboOutDir(ev.target.value)}
                    disabled={pboBusy}
                    placeholder="mission_projects/output (default)"
                  />
                  <span className="field-hint">
                    Full path to a directory. Empty uses the PBO next to the mission folder (not the shared output
                    folder).
                  </span>
                </label>

                {pboErr ? (
                  <p className="form-banner form-banner-error" role="alert">
                    {pboErr}
                  </p>
                ) : null}
                {pboResultPath ? (
                  <p className="form-banner form-banner-success" role="status">
                    Wrote <strong>{pboResultPath}</strong>
                  </p>
                ) : null}

                <pre className="pbo-build-log" aria-live="polite">
                  {pboLogLines.join('\n')}
                </pre>
              </div>
            </div>

            <footer className="mission-edit-footer">
              <div className="mission-edit-footer-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pboBusy || !pboMission.project_path}
                  onClick={() => void runPboBuild(false)}
                >
                  {pboBusy ? 'Building…' : 'Build'}
                </button>
                {pboResultPath ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={pboBusy}
                    onClick={() =>
                      void Util.revealPathInExplorer(pboResultPath, pboMission.project_path ?? '').catch(
                        (e) => setPboErr(e instanceof Error ? e.message : 'Could not open Explorer'),
                      )
                    }
                  >
                    Open in Explorer
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" disabled={pboBusy} onClick={() => closePboModal()}>
                  Close
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
      {pboMission && pboOverwritePath !== null ? (
        <div
          className="modal-root modal-root-stacked"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pbo-overwrite-title"
        >
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Dismiss replace prompt"
            onClick={() => setPboOverwritePath(null)}
          />
          <div className="modal-dialog modal-dialog-confirm">
            <h2 id="pbo-overwrite-title" className="card-title">
              Replace existing PBO?
            </h2>
            <p className="card-body pbo-overwrite-lead">
              A file already exists at the build output path. Replace it with a new build?
            </p>
            <p className="card-body pbo-overwrite-path">
              <code className="shell-inline-code">{pboOverwritePath}</code>
            </p>
            <div className="modal-actions pbo-overwrite-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPboOverwritePath(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPboOverwritePath(null)
                  void runPboBuild(true)
                }}
              >
                Replace file
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* <header className="page-header">
        <h1 className="page-title">Missions</h1>
      </header> */}

      {loadError && (
        <p className="form-banner form-banner-error" role="alert">
          {loadError}
        </p>
      )}
      {saveInfo && !editMission && (
        <p className="form-banner form-banner-success" role="status">
          {saveInfo}
        </p>
      )}

      <div className="card">
        <div className="mission-list-card-head">
          <h2 className="card-title">All missions</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + New Mission
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        {loading && <p className="card-body">Loading…</p>}

        {!loading && scenarios.length === 0 && !loadError && (
          <p className="card-body">No managed missions yet.</p>
        )}

        {!loading && scenarios.length > 0 && (
          <ul className="mission-list">
            {scenarios.map((scenario) => (
              <li key={scenario.id} className="mission-list-item">
                <div className="mission-list-row">
                  <div className="mission-list-main">
                    <div className="mission-list-title">{fullMissionName(scenario)}</div>
                    <div className="mission-list-meta">
                      <span>By {scenario.author}</span>
                      <span className="mission-list-pill">{scenario.mission_type?.toUpperCase() || '—'}</span>
                      <span className="mission-list-pill mission-list-pill-accent">
                        {(scenarioGameTypes[scenario.id] ?? '').toUpperCase() || '—'}
                      </span>
                      {hasSymlinkPaths(scenario) ? (
                        <span className="mission-list-pill mission-list-pill-on">Symlink</span>
                      ) : (
                        <span className="mission-list-pill mission-list-pill-off">Symlink missing</span>
                      )}
                      {scenario.github_integration ? (
                        <span className="mission-list-pill mission-list-pill-on" title="GitHub integration enabled">
                          Git
                        </span>
                      ) : null}
                    </div>
                    {scenario.description ? (
                      <p className="mission-list-desc">{scenario.description}</p>
                    ) : null}
                    {scenario.project_path ? (
                      <div className="mission-list-script-row">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={loading}
                          onClick={() => {
                            const root = scenario.project_path?.trim()
                            if (!root) return
                            setScriptEditor({ root, title: fullMissionName(scenario) })
                          }}
                        >
                          Open in Script Editor
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditMission(scenario)} title="Edit mission" disabled={loading}>
                    <FontAwesomeIcon icon={faEdit} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openDeleteDialog(scenario)}
                    disabled={loading}
                    title="Delete mission from Launchpad"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void Util.runCommand(`code ${JSON.stringify(scenario.project_path ?? '')}`)}
                    disabled={!scenario.project_path || loading}
                    title="Open in VSCode"
                  >
                    <VSCodeIcon />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void openModsDialog(scenario)}
                    disabled={loading}
                    title="Manage Modlist"
                  >
                    <FontAwesomeIcon icon={faList} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openPboModal(scenario)}
                    disabled={!scenario.project_path || loading}
                    title="Build PBO"
                  >
                    <FontAwesomeIcon icon={faArchive} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void runMission(scenario)}
                    disabled={loading}
                    title="Run Mission"
                  >
                    <FontAwesomeIcon icon={faPlay} />
                  </button>                  
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setGithubMission(scenario)}
                    disabled={!scenario.project_path || loading || !scenario.github_integration}
                    title={
                      !scenario.github_integration
                        ? 'Enable GitHub integration in Edit → GitHub'
                        : 'Local git history and commits'
                    }
                  >
                    <FontAwesomeIcon icon={faGithub} />
                  </button>
                  <div className="mission-list-menu-anchor" data-mission-row-menu={scenario.id}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-haspopup="menu"
                      aria-expanded={missionMenuOpenId === scenario.id}
                      aria-controls={`mission-row-menu-${scenario.id}`}
                      id={`mission-row-menu-trigger-${scenario.id}`}
                      disabled={loading}
                      title="More actions"
                      aria-label="More actions"
                      onClick={() =>
                        setMissionMenuOpenId((cur) => (cur === scenario.id ? null : scenario.id))
                      }
                    >
                      <FontAwesomeIcon icon={faEllipsisVertical} />
                    </button>
                    {missionMenuOpenId === scenario.id ? (
                      <ul
                        className="mission-list-dropdown"
                        id={`mission-row-menu-${scenario.id}`}
                        role="menu"
                        aria-labelledby={`mission-row-menu-trigger-${scenario.id}`}
                      >
                        <li role="none">
                          <button
                            type="button"
                            className="mission-list-dropdown-item"
                            role="menuitem"
                            disabled={!scenario.project_path?.trim()}
                            onClick={() => {
                              const root = scenario.project_path?.trim()
                              if (!root) return
                              setScriptEditor({ root, title: fullMissionName(scenario) })
                              setMissionMenuOpenId(null)
                            }}
                          >
                            Open in Script Editor
                          </button>
                        </li>
                      </ul>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
