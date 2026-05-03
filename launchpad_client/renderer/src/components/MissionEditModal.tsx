import { useCallback, useEffect, useRef, useState } from 'react'
import { updateManagedScenario, type ManagedScenario } from '../api/launchpad'
import {
  extractGameTypeFromDescriptionExt,
  missionDescriptionExtPath,
  parseDescriptionExt,
  serializeDescriptionExt,
  type DescriptionExtModel,
} from '../mission/descriptionExt'

function modelBaselineJson(m: DescriptionExtModel): string {
  return JSON.stringify({
    header: m.header,
    difficultyOverride: m.difficultyOverride,
    roots: m.roots,
  })
}
import { ScriptEditorModal } from './Editor/IntegratedScriptEditor'
import Util from '../utils'

export type MissionEditModalProps = {
  mission: ManagedScenario
  onClose: () => void
  onSaved: () => void
  onMissionUpdated: (m: ManagedScenario) => void
}

type EditSection = 'identity' | 'missionFile' | 'github' | 'resources'

function cloneModel(m: DescriptionExtModel): DescriptionExtModel {
  return {
    header: { ...m.header },
    difficultyOverride: { ...m.difficultyOverride },
    roots: m.roots.map((r) => ({ ...r, value: deepCloneValue(r.value) })),
  }
}

function deepCloneValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => deepCloneValue(x))
  if (v && typeof v === 'object') return { ...(v as Record<string, unknown>) }
  return v
}

function headerString(model: DescriptionExtModel, key: string): string {
  const v = model.header[key]
  return typeof v === 'string' ? v : ''
}

function headerNumber(model: DescriptionExtModel, key: string): number {
  const v = model.header[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}

function setHeaderString(model: DescriptionExtModel, key: string, s: string) {
  model.header[key] = s
}

function setHeaderNumber(model: DescriptionExtModel, key: string, n: number) {
  model.header[key] = Number.isFinite(n) ? Math.trunc(n) : 0
}

function difficultyNumber(model: DescriptionExtModel, key: string): number {
  const v = model.difficultyOverride[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return 0
}

function setDifficultyNumber(model: DescriptionExtModel, key: string, n: number) {
  model.difficultyOverride[key] = Number.isFinite(n) ? Math.trunc(n) : 0
}

export function MissionEditModal({ mission, onClose, onSaved, onMissionUpdated }: MissionEditModalProps) {
  const [section, setSection] = useState<EditSection>('identity')
  const [editName, setEditName] = useState(mission.name ?? '')
  const [editMapSuffix, setEditMapSuffix] = useState(mission.map_suffix ?? '')
  const [editGithubIntegration, setEditGithubIntegration] = useState(Boolean(mission.github_integration))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false)

  const [descLoading, setDescLoading] = useState(false)
  const [descLoadError, setDescLoadError] = useState<string | null>(null)
  const [descRawMode, setDescRawMode] = useState(false)
  const [descRawText, setDescRawText] = useState('')
  const [descInitialRaw, setDescInitialRaw] = useState('')
  const [descModel, setDescModel] = useState<DescriptionExtModel | null>(null)
  const descModelBaselineJson = useRef('')
  const [headerGameTypePreview, setHeaderGameTypePreview] = useState('')

  const projectPath = mission.project_path?.trim()
  const descPath = projectPath ? missionDescriptionExtPath(projectPath) : ''

  useEffect(() => {
    setEditName(mission.name ?? '')
    setEditMapSuffix(mission.map_suffix ?? '')
    setEditGithubIntegration(Boolean(mission.github_integration))
    setSaveError(null)
    setScriptEditorOpen(false)
    setSection('identity')
  }, [mission])

  useEffect(() => {
    let cancelled = false
    async function loadDesc() {
      if (!descPath) {
        setDescLoading(false)
        setDescLoadError(null)
        setDescModel(null)
        setDescRawMode(false)
        setDescRawText('')
        setDescInitialRaw('')
        descModelBaselineJson.current = ''
        setHeaderGameTypePreview('')
        return
      }
      setDescLoading(true)
      setDescLoadError(null)
      try {
        const text = await Util.getFileContents(descPath)
        if (cancelled) return
        setHeaderGameTypePreview(extractGameTypeFromDescriptionExt(text))
        const parsed = parseDescriptionExt(text)
        if (parsed.ok) {
          const model = cloneModel(parsed.model)
          setDescModel(model)
          descModelBaselineJson.current = modelBaselineJson(model)
          setDescRawMode(false)
          setDescRawText(text)
          setDescInitialRaw(text)
        } else {
          setDescModel(null)
          descModelBaselineJson.current = ''
          setDescRawMode(true)
          setDescRawText(text)
          setDescInitialRaw(text)
        }
      } catch (e) {
        if (!cancelled) {
          setDescLoadError(e instanceof Error ? e.message : 'Could not load mission settings file.')
          setDescModel(null)
          setDescRawMode(false)
          setDescRawText('')
          setDescInitialRaw('')
          descModelBaselineJson.current = ''
          setHeaderGameTypePreview('')
        }
      } finally {
        if (!cancelled) setDescLoading(false)
      }
    }
    void loadDesc()
    return () => {
      cancelled = true
    }
  }, [descPath, mission.id, mission.author])

  const descDirty = descRawMode
    ? descRawText !== descInitialRaw
    : descModel !== null && modelBaselineJson(descModel) !== descModelBaselineJson.current

  const updateModel = useCallback((fn: (m: DescriptionExtModel) => void) => {
    setDescModel((prev) => {
      if (!prev) return prev
      const next = cloneModel(prev)
      fn(next)
      return next
    })
  }, [])

  const fullPreview = `${editName.trim() || 'name'}.${editMapSuffix.trim() || 'map'}`

  const saveAll = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await updateManagedScenario(mission.id, {
        name: editName.trim(),
        map_suffix: editMapSuffix.trim(),
        github_integration: editGithubIntegration,
      })
      if ('error' in res && res.error) {
        setSaveError(res.error)
        return
      }
      if (!res.ok) {
        setSaveError('Could not save mission.')
        return
      }
      onMissionUpdated(res.mission)
      if (descPath && descDirty) {
        try {
          let written = ''
          if (descRawMode) {
            await Util.setFileContents(descPath, descRawText)
            written = descRawText
            setDescInitialRaw(descRawText)
          } else if (descModel) {
            written = serializeDescriptionExt(descModel, {
              author: mission.author || 'Unknown',
              bannerNote: 'Saved from A3 Launchpad.',
            })
            await Util.setFileContents(descPath, written)
            setDescRawText(written)
            setDescInitialRaw(written)
            descModelBaselineJson.current = modelBaselineJson(descModel)
          }
          setHeaderGameTypePreview(extractGameTypeFromDescriptionExt(written))
        } catch (e) {
          setSaveError(e instanceof Error ? e.message : 'Could not save mission settings file.')
          onSaved()
          return
        }
      }
      onSaved()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSaving(false)
    }
  }, [
    mission.id,
    mission.author,
    editName,
    editMapSuffix,
    editGithubIntegration,
    descPath,
    descDirty,
    descRawMode,
    descRawText,
    descModel,
    onMissionUpdated,
    onSaved,
  ])

  const missionContextTitle = fullPreview

  const gameTypePill = (headerGameTypePreview || '').toUpperCase() || '—'

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="mission-edit-title">
      <ScriptEditorModal
        open={scriptEditorOpen && Boolean(projectPath)}
        projectRoot={projectPath ?? ''}
        contextTitle={missionContextTitle}
        environment="mission"
        disabled={saving}
        onClose={() => setScriptEditorOpen(false)}
      />
      <button type="button" className="modal-backdrop" aria-label="Close dialog" onClick={() => onClose()} />
      <div className="modal-dialog modal-dialog-wide mission-edit-dialog">
        <header className="mission-edit-header">
          <div className="mission-edit-header-main">
            <p className="mission-edit-eyebrow">Managed mission</p>
            <h2 id="mission-edit-title" className="mission-edit-title">
              {fullPreview}
            </h2>
            <div className="mission-edit-meta" aria-label="Mission summary">
              <span className="mission-edit-pill">By {mission.author || '—'}</span>
              <span className="mission-edit-pill mission-edit-pill-accent">{mission.mission_type?.toUpperCase() || '—'}</span>
              <span className="mission-edit-pill mission-edit-pill-accent">{gameTypePill}</span>
            </div>
          </div>
          <button
            type="button"
            className="mission-edit-close"
            onClick={() => onClose()}
            aria-label="Close"
            disabled={saving}
          >
            <span aria-hidden>×</span>
          </button>
        </header>

        <nav className="mission-edit-nav" role="tablist" aria-label="Edit sections">
          <button
            type="button"
            role="tab"
            aria-selected={section === 'identity'}
            className={`mission-edit-nav-btn${section === 'identity' ? ' is-active' : ''}`}
            onClick={() => setSection('identity')}
          >
            Name &amp; map
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'missionFile'}
            className={`mission-edit-nav-btn${section === 'missionFile' ? ' is-active' : ''}`}
            onClick={() => setSection('missionFile')}
            disabled={!projectPath}
            title={!projectPath ? 'No project folder on record' : undefined}
          >
            Mission settings
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'github'}
            className={`mission-edit-nav-btn${section === 'github' ? ' is-active' : ''}`}
            onClick={() => setSection('github')}
          >
            GitHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === 'resources'}
            className={`mission-edit-nav-btn${section === 'resources' ? ' is-active' : ''}`}
            onClick={() => setSection('resources')}
            disabled={!projectPath}
            title={!projectPath ? 'No project folder on record' : undefined}
          >
            Resources
          </button>
        </nav>

        <div className="mission-edit-surface">
          {section === 'identity' && (
            <div className="mission-edit-section mission-edit-section-identity">
              <p className="mission-edit-lead">
                Folder name on disk is <strong>{fullPreview}</strong>. Changing name or map updates the managed record
                and may rename the Arma profile symlink when paths are set.
              </p>
              <div className="mission-edit-fields-grid">
                <label className="field">
                  <span className="field-label">Mission name</span>
                  <input
                    type="text"
                    className="field-input"
                    autoComplete="off"
                    value={editName}
                    onChange={(ev) => setEditName(ev.target.value)}
                    disabled={saving}
                  />
                  <span className="field-hint">
                    The part before the dot in the mission folder name. Examples:{' '}
                    <code className="mission-edit-code">MyOp</code>, <code className="mission-edit-code">Campaign01</code>.
                  </span>
                </label>
                <label className="field">
                  <span className="field-label">Map suffix</span>
                  <input
                    type="text"
                    className="field-input"
                    autoComplete="off"
                    value={editMapSuffix}
                    onChange={(ev) => setEditMapSuffix(ev.target.value)}
                    disabled={saving}
                  />
                  <span className="field-hint">
                    The world / terrain token after the dot. Examples:{' '}
                    <code className="mission-edit-code">Altis</code>, <code className="mission-edit-code">Tanoa</code>.
                  </span>
                </label>
              </div>
            </div>
          )}

          {section === 'missionFile' && (
            <div className="mission-edit-section">
              {!projectPath ? (
                <div className="mission-edit-empty">
                  <p className="mission-edit-empty-title">No project folder</p>
                  <p className="mission-edit-empty-text">Add a project path for this mission to edit its settings file.</p>
                </div>
              ) : descLoading ? (
                <p className="mission-edit-lead">Loading…</p>
              ) : descLoadError ? (
                <p className="form-banner form-banner-error" role="alert">
                  {descLoadError}
                </p>
              ) : descRawMode ? (
                <>
                  <p className="mission-edit-lead">
                    This file uses a layout the guided editor does not recognize yet. You can still edit the full text
                    here or in the script workspace. See the{' '}
                    <a href="https://community.bistudio.com/wiki/Description.ext" target="_blank" rel="noopener noreferrer">
                      Bohemia Wiki
                    </a>{' '}
                    for field meanings.
                  </p>
                  <label className="field mission-edit-field-grow">
                    <textarea
                      className="field-input mission-ext-json"
                      value={descRawText}
                      onChange={(ev) => setDescRawText(ev.target.value)}
                      disabled={saving}
                      spellCheck={false}
                      aria-label="Mission settings file"
                    />
                  </label>
                  <div className="mission-edit-footer-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={saving}
                      onClick={() => setScriptEditorOpen(true)}
                    >
                      Open in Script Editor
                    </button>
                  </div>
                </>
              ) : descModel ? (
                <>
                  <p className="mission-edit-lead">
                    These values are stored in your mission&apos;s settings file on disk. For every other option, use the
                    script workspace or edit the file in an external editor.{' '}
                    <a href="https://community.bistudio.com/wiki/Description.ext" target="_blank" rel="noopener noreferrer">
                      Bohemia Wiki
                    </a>
                  </p>
                  <div className="mission-edit-fields-grid">
                    <label className="field">
                      <span className="field-label">Game type</span>
                      <input
                        type="text"
                        className="field-input"
                        autoComplete="off"
                        value={headerString(descModel, 'gameType')}
                        onChange={(ev) =>
                          updateModel((m) => {
                            setHeaderString(m, 'gameType', ev.target.value)
                          })
                        }
                        disabled={saving}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Min players</span>
                      <input
                        type="number"
                        className="field-input"
                        value={headerNumber(descModel, 'minPlayers')}
                        onChange={(ev) =>
                          updateModel((m) => {
                            setHeaderNumber(m, 'minPlayers', Number(ev.target.value))
                          })
                        }
                        disabled={saving}
                        min={0}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Max players</span>
                      <input
                        type="number"
                        className="field-input"
                        value={headerNumber(descModel, 'maxPlayers')}
                        onChange={(ev) =>
                          updateModel((m) => {
                            setHeaderNumber(m, 'maxPlayers', Number(ev.target.value))
                          })
                        }
                        disabled={saving}
                        min={0}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Tactical ping</span>
                      <input
                        type="number"
                        className="field-input"
                        value={difficultyNumber(descModel, 'tacticalPing')}
                        onChange={(ev) =>
                          updateModel((m) => {
                            setDifficultyNumber(m, 'tacticalPing', Number(ev.target.value))
                          })
                        }
                        disabled={saving}
                        min={0}
                      />
                      <span className="field-hint">Difficulty override (0 = default).</span>
                    </label>
                  </div>
                  <p className="field-hint" style={{ marginTop: 8 }}>
                    {descModel.roots.length} more option line{descModel.roots.length === 1 ? '' : 's'} in this file are
                    preserved when you save from this panel.
                  </p>
                  <div className="mission-edit-footer-actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={saving}
                      onClick={() => setScriptEditorOpen(true)}
                    >
                      Open in Script Editor
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {section === 'github' && (
            <div className="mission-edit-section mission-edit-section-identity">
              <p className="mission-edit-lead">
                When enabled, the <strong>GitHub</strong> button on the mission list opens a simple panel for recent
                commits and local commits. Your project folder should be a Git repository (
                <code className="mission-edit-code">git init</code> or clone). This does not configure remotes or
                GitHub authentication; it runs local <code className="mission-edit-code">git</code> only.
              </p>
              <label className="modal-checkbox-field mission-edit-github-check">
                <input
                  type="checkbox"
                  checked={editGithubIntegration}
                  onChange={(ev) => setEditGithubIntegration(ev.target.checked)}
                  disabled={saving}
                />
                <span>Enable GitHub integration for this mission</span>
              </label>
            </div>
          )}

          {section === 'resources' && (
            <div className="mission-edit-section">
              {!projectPath ? (
                <div className="mission-edit-empty">
                  <p className="mission-edit-empty-title">No project folder</p>
                  <p className="mission-edit-empty-text">This mission has no project path on record, so files cannot be browsed.</p>
                </div>
              ) : (
                <>
                  <p className="mission-edit-lead">
                    Browse your mission folder, open files in the editor, and save changes when you are ready.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={() => setScriptEditorOpen(true)}
                  >
                    Open in Script Editor
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {saveError ? (
          <p className="mission-edit-banner form-banner form-banner-error" role="alert">
            {saveError}
          </p>
        ) : null}

        <footer className="mission-edit-footer">
          <div className="mission-edit-footer-actions">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveAll()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => onClose()}>
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
