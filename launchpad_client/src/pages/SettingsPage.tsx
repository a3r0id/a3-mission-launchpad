import { useCallback, useEffect, useState } from 'react'
import {
  fetchSettings,
  updateSettings,
  type LaunchpadSettings,
} from '../api/launchpad'

function trimField(v: string | undefined | null): string {
  return (v ?? '').trim()
}

function sameSettings(a: LaunchpadSettings, b: LaunchpadSettings) {
  return (
    a.arma3_path === b.arma3_path &&
    a.arma3_tools_path === b.arma3_tools_path &&
    a.arma3_profile_path === b.arma3_profile_path &&
    a.default_author === b.default_author
  )
}

export function SettingsPage() {
  const [saved, setSaved] = useState<LaunchpadSettings | null>(null)
  const [arma3Path, setArma3Path] = useState('')
  const [toolsPath, setToolsPath] = useState('')
  const [profilePath, setProfilePath] = useState('')
  const [defaultAuthor, setDefaultAuthor] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)
  const [saving, setSaving] = useState(false)

  const draft: LaunchpadSettings = {
    arma3_path: trimField(arma3Path),
    arma3_tools_path: trimField(toolsPath),
    arma3_profile_path: trimField(profilePath),
    default_author: trimField(defaultAuthor),
  }

  const dirty = saved ? !sameSettings(draft, saved) : false

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSaveOk(false)
    try {
      const s = await fetchSettings()
      setSaved(s)
      setArma3Path(s.arma3_path ?? '')
      setToolsPath(s.arma3_tools_path ?? '')
      setProfilePath(s.arma3_profile_path ?? '')
      setDefaultAuthor(s.default_author ?? '')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load settings')
      setSaved(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onSave() {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const res = await updateSettings({
        arma3_path: trimField(arma3Path),
        arma3_tools_path: trimField(toolsPath),
        arma3_profile_path: trimField(profilePath),
        default_author: trimField(defaultAuthor),
      })
      if ('error' in res && res.error) {
        setSaveError(res.error)
        return
      }
      if (!res.ok) {
        setSaveError('Save failed')
        return
      }
      setSaved({
        arma3_path: res.arma3_path ?? '',
        arma3_tools_path: res.arma3_tools_path ?? '',
        arma3_profile_path: res.arma3_profile_path ?? '',
        default_author: res.default_author ?? '',
      })
      setArma3Path(res.arma3_path ?? '')
      setToolsPath(res.arma3_tools_path ?? '')
      setProfilePath(res.arma3_profile_path ?? '')
      setDefaultAuthor(res.default_author ?? '')
      setSaveOk(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function onDiscard() {
    if (!saved) return
    setArma3Path(saved.arma3_path ?? '')
    setToolsPath(saved.arma3_tools_path ?? '')
    setProfilePath(saved.arma3_profile_path ?? '')
    setDefaultAuthor(saved.default_author ?? '')
    setSaveError(null)
    setSaveOk(false)
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-lead">
          Settings can be edited manually in <span className="shell-inline-code">launchpad_data/settings.json</span>.
        </p>
      </header>

      {loadError && (
        <p className="form-banner form-banner-error" role="alert">
          {loadError}
        </p>
      )}
      {saveError && (
        <p className="form-banner form-banner-error" role="alert">
          {saveError}
        </p>
      )}
      {saveOk && !dirty && (
        <p className="form-banner form-banner-success" role="status">
          Settings saved.
        </p>
      )}

      <section className="card form-card" aria-labelledby="paths-heading">
        <h2 id="paths-heading" className="card-title">
          Arma 3 paths
        </h2>
        {loading && <p className="card-body">Loading…</p>}

        {!loading && (
          <>
            <label className="field">
              <span className="field-label">Arma 3 installation folder</span>
              <input
                className="field-input"
                name="arma3_path"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. C:\Program Files (x86)\Steam\steamapps\common\Arma 3"
                value={arma3Path}
                onChange={(e) => {
                  setArma3Path(e.target.value)
                  setSaveOk(false)
                }}
              />
              <span className="field-hint">Game root directory (contains arma3.exe).</span>
            </label>

            <label className="field">
              <span className="field-label">Arma 3 Tools folder</span>
              <input
                className="field-input"
                name="arma3_tools_path"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. C:\Program Files (x86)\Steam\steamapps\common\Arma 3 Tools"
                value={toolsPath}
                onChange={(e) => {
                  setToolsPath(e.target.value)
                  setSaveOk(false)
                }}
              />
              <span className="field-hint">Steam “Arma 3 Tools” app folder, if you use it.</span>
            </label>

            <label className="field">
              <span className="field-label">Arma 3 profile folder</span>
              <input
                className="field-input"
                name="arma3_profile_path"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. C:\Users\You\Documents\Arma 3 - Other Profiles\YourProfileName"
                value={profilePath}
                onChange={(e) => {
                  setProfilePath(e.target.value)
                  setSaveOk(false)
                }}
              />
              <span className="field-hint">
                Required for new Missions: the folder that contains <span className="shell-inline-code">missions</span>{' '}
                and <span className="shell-inline-code">mpmissions</span> (where the launcher creates the scenario
                symlink).
              </span>
            </label>

            <label className="field">
              <span className="field-label">Default author</span>
              <input
                className="field-input"
                name="default_author"
                type="text"
                autoComplete="name"
                spellCheck={false}
                placeholder="Your name or team"
                value={defaultAuthor}
                onChange={(e) => {
                  setDefaultAuthor(e.target.value)
                  setSaveOk(false)
                }}
              />
              <span className="field-hint">
                Prefills the Author field on New Mission. If you leave Author empty there, this value is still used for
                the build.
              </span>
            </label>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onSave()}
                disabled={saving || !dirty}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onDiscard}
                disabled={saving || !dirty || !saved}
              >
                Discard changes
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void load()}
                disabled={saving || loading}
              >
                Reload from disk
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
