import { useCallback, useEffect, useState } from 'react'
import { deleteManagedScenario, fetchManagedScenarios, type ManagedScenario } from '../api/launchpad'
import { MissionEditModal } from '../components/MissionEditModal'
import Util, { PboOutputExistsError } from '../Util'

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

export function MissionListPage() {
  const [scenarios, setScenarios] = useState<ManagedScenario[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editMission, setEditMission] = useState<ManagedScenario | null>(null)
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

  function openPboModal(s: ManagedScenario) {
    setPboMission(s)
    setPboOutDir(parentDir(s.project_path ?? ''))
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

  async function confirmDeleteMission() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteErr(null)
    try {
      await deleteManagedScenario(deleteTarget.id, { deleteProjectFiles: deleteRemoveDisk })
      if (editMission?.id === deleteTarget.id) setEditMission(null)
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
                  . Leave the folder blank to write next to the mission folder, or set a parent directory.
                  You can paste a full path ending in <code className="mission-edit-code">.pbo</code> — only the
                  parent folder is used; the filename stays as above.
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
                    placeholder="Leave blank to place next to the mission folder"
                  />
                  <span className="field-hint">
                    Full path to a directory, or empty for the default beside the mission.
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

      <header className="page-header">
        <h1 className="page-title">Managed Missions</h1>
      </header>

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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
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
                      <span>{scenario.author}</span>
                      <span className="mission-list-pill">{scenario.mission_type}</span>
                      {hasSymlinkPaths(scenario) ? (
                        <span className="mission-list-pill mission-list-pill-on">Symlink data</span>
                      ) : (
                        <span className="mission-list-pill">Symlink data missing</span>
                      )}
                    </div>
                    {scenario.description ? (
                      <p className="mission-list-desc">{scenario.description}</p>
                    ) : null}
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditMission(scenario)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openDeleteDialog(scenario)}
                    disabled={loading}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void Util.runCommand(`code ${JSON.stringify(scenario.project_path ?? '')}`)}
                    disabled={!scenario.project_path || loading}
                  >
                    Open In VSCode
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openPboModal(scenario)}
                    disabled={!scenario.project_path || loading}
                  >
                    Build Mission PBO
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
