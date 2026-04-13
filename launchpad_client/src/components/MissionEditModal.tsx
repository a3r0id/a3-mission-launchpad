import { useCallback, useEffect, useState } from 'react'
import { gameTypeFromExtParams, updateManagedScenario, type ManagedScenario } from '../api/launchpad'
import { MissionResourceBrowser } from './MissionResourceBrowser'

function stringifyExt(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export type MissionEditModalProps = {
  mission: ManagedScenario
  onClose: () => void
  onSaved: () => void
  onMissionUpdated: (m: ManagedScenario) => void
}

type EditSection = 'identity' | 'ext' | 'resources'

export function MissionEditModal({ mission, onClose, onSaved, onMissionUpdated }: MissionEditModalProps) {
  const [section, setSection] = useState<EditSection>('identity')
  const [editName, setEditName] = useState(mission.name ?? '')
  const [editMapSuffix, setEditMapSuffix] = useState(mission.map_suffix ?? '')
  const [editExtJson, setEditExtJson] = useState(() => stringifyExt(mission.ext_params))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditName(mission.name ?? '')
    setEditMapSuffix(mission.map_suffix ?? '')
    setEditExtJson(stringifyExt(mission.ext_params))
    setSaveError(null)
  }, [mission])

  const fullPreview = `${editName.trim() || 'name'}.${editMapSuffix.trim() || 'map'}`

  const saveAll = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    let extParsed: unknown
    try {
      extParsed = JSON.parse(editExtJson) as unknown
    } catch {
      setSaveError('EXT params must be valid JSON.')
      setSaving(false)
      setSection('ext')
      return
    }
    try {
      const res = await updateManagedScenario(mission.id, {
        name: editName.trim(),
        map_suffix: editMapSuffix.trim(),
        ext_params: extParsed,
      })
      if ('error' in res && res.error) {
        setSaveError(res.error)
        return
      }
      if (res.ok) {
        onMissionUpdated(res.mission)
        onSaved()
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setSaving(false)
    }
  }, [mission.id, editName, editMapSuffix, editExtJson, onMissionUpdated, onSaved])

  const projectPath = mission.project_path?.trim()

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="mission-edit-title">
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
              <span className="mission-edit-pill mission-edit-pill-accent">
                {gameTypeFromExtParams(mission.ext_params).toUpperCase() || '—'}
              </span>
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
            aria-selected={section === 'ext'}
            className={`mission-edit-nav-btn${section === 'ext' ? ' is-active' : ''}`}
            onClick={() => setSection('ext')}
          >
            EXT params
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

          {section === 'ext' && (
            <div className="mission-edit-section">
              <p className="mission-edit-lead">
                Arbitrary JSON stored on the mission record for tooling or templates. Invalid JSON cannot be saved.
              </p>
              <label className="field mission-edit-field-grow">
                <span className="field-label">ext_params</span>
                <textarea
                  className="field-input mission-ext-json"
                  value={editExtJson}
                  onChange={(ev) => setEditExtJson(ev.target.value)}
                  disabled={saving}
                  spellCheck={false}
                  aria-label="Extension parameters as JSON"
                />
              </label>
            </div>
          )}

          {section === 'resources' && (
            <div className="mission-edit-section mission-edit-section-flush">
              {!projectPath ? (
                <div className="mission-edit-empty">
                  <p className="mission-edit-empty-title">No project folder</p>
                  <p className="mission-edit-empty-text">This mission has no project path on record, so files cannot be browsed.</p>
                </div>
              ) : (
                <MissionResourceBrowser projectRoot={projectPath} disabled={saving} />
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
