import { useCallback, useEffect, useState } from 'react'
import {
  fetchManagedScenarios,
  updateManagedScenario,
  type ManagedScenario,
} from '../api/launchpad'
import Util from '../Util'

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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editMapSuffix, setEditMapSuffix] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveInfo, setSaveInfo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [pboMission, setPboMission] = useState<ManagedScenario | null>(null)
  const [pboOutDir, setPboOutDir] = useState('')
  const [pboLogLines, setPboLogLines] = useState<string[]>([])
  const [pboBusy, setPboBusy] = useState(false)
  const [pboErr, setPboErr] = useState<string | null>(null)
  const [pboResultPath, setPboResultPath] = useState<string | null>(null)

  function openPboModal(s: ManagedScenario) {
    setPboMission(s)
    setPboOutDir(parentDir(s.project_path ?? ''))
    setPboLogLines([])
    setPboErr(null)
    setPboResultPath(null)
  }

  function closePboModal() {
    if (pboBusy) return
    setPboMission(null)
  }

  async function runPboBuild() {
    const proj = pboMission?.project_path?.trim()
    if (!proj) return
    setPboBusy(true)
    setPboErr(null)
    setPboLogLines([])
    setPboResultPath(null)
    try {
      await Util.buildMissionPBOStream(proj, pboOutDir.trim() || undefined, (ev) => {
        if (ev.type === 'log') {
          setPboLogLines((prev) => [...prev, ev.message])
        } else if (ev.type === 'error') {
          setPboErr(ev.message)
        } else if (ev.type === 'done') {
          setPboResultPath(ev.pboPath)
        }
      })
    } catch (e) {
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

  function startEdit(s: ManagedScenario) {
    setEditingId(s.id)
    setEditName(s.name ?? '')
    setEditMapSuffix(s.map_suffix ?? '')
    setSaveError(null)
    setSaveInfo(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setSaveError(null)
    setSaveInfo(null)
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    setSaveError(null)
    setSaveInfo(null)
    try {
      const res = await updateManagedScenario(editingId, {
        name: editName.trim(),
        map_suffix: editMapSuffix.trim(),
      })
      if ('error' in res && res.error) {
        setSaveError(res.error)
        return
      }
      if (res.ok) {
        await load()
        setSaveInfo(res.symlink_message ?? 'Saved.')
        setEditingId(null)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-stack">
      {pboMission ? (
        <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="pbo-modal-title">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close dialog"
            onClick={() => closePboModal()}
            disabled={pboBusy}
          />
          <div className="modal-dialog">
            <h2 id="pbo-modal-title" className="card-title">
              Build mission PBO
            </h2>
            <p className="card-body" style={{ margin: 0, fontSize: 13 }}>
              {fullMissionName(pboMission)}
            </p>
            <label className="field">
              <span className="field-label" style={{ width: '100%' }}>Output folder or full .pbo path</span>
              <input
                className="field-input"
                name="pbo_output"
                autoComplete="off"
                value={pboOutDir}
                onChange={(ev) => setPboOutDir(ev.target.value)}
                disabled={pboBusy}
                placeholder="Leave blank to place next to the mission folder"
              />
              <span className="field-hint">
                Folder only: the file will be named like the mission folder with a .pbo extension. You
                can also paste a full path ending in .pbo.
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
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={pboBusy || !pboMission.project_path}
                onClick={() => void runPboBuild()}
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
          </div>
        </div>
      ) : null}

      <header className="page-header">
        <h1 className="page-title">Managed scenarios</h1>
      </header>

      {loadError && (
        <p className="form-banner form-banner-error" role="alert">
          {loadError}
        </p>
      )}
      {saveInfo && !editingId && (
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
            {scenarios.map((scenario) => {
              const isEditing = editingId === scenario.id
              return (
                <li key={scenario.id} className="mission-list-item">
                  {!isEditing && (
                    <div className="mission-list-row">
                      <div className="mission-list-main">
                        <div className="mission-list-title">{fullMissionName(scenario)}</div>
                        <div className="mission-list-meta">
                          <span>{scenario.author}</span>
                          <span className="mission-list-pill">{scenario.mission_type}</span>
                          {hasSymlinkPaths(scenario) ? (
                            <span className="mission-list-pill mission-list-pill-on">
                              Symlink data
                            </span>
                          ) : (
                            <span className="mission-list-pill">Symlink data missing</span>
                          )}
                        </div>
                        {scenario.description ? (
                          <p className="mission-list-desc">{scenario.description}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => startEdit(scenario)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() =>
                          void Util.runCommand(
                            `code ${JSON.stringify(scenario.project_path ?? '')}`,
                          )
                        }
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
                  )}
                  {isEditing && (
                    <div className="card form-card mission-list-edit">
                      <h3 className="card-title">Edit mission</h3>
                      <label className="field">
                        <span className="field-label">Mission name</span>
                        <input
                          className="field-input"
                          name="name"
                          autoComplete="off"
                          value={editName}
                          onChange={(ev) => setEditName(ev.target.value)}
                        />
                        <span className="field-hint">Folder name without the map suffix.</span>
                      </label>
                      <label className="field">
                        <span className="field-label">Map suffix</span>
                        <input
                          className="field-input"
                          name="map_suffix"
                          autoComplete="off"
                          value={editMapSuffix}
                          onChange={(ev) => setEditMapSuffix(ev.target.value)}
                        />
                        <span className="field-hint">
                          Full folder name preview:{' '}
                          <strong>
                            {(editName.trim() || 'name') + '.' + (editMapSuffix.trim() || 'map')}
                          </strong>
                        </span>
                      </label>
                      {saveError && (
                        <p className="form-banner form-banner-error" role="alert">
                          {saveError}
                        </p>
                      )}
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={saving}
                          onClick={() => void saveEdit()}
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={saving}
                          onClick={cancelEdit}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
