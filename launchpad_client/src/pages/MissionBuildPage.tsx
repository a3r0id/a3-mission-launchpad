import { useEffect, useState, type FormEvent } from 'react'
import {
  fetchMissionBuild,
  fetchSettings,
  type LaunchpadSettings,
  type MissionBuildResponse,
} from '../api/launchpad'

type MissionBuildPageProps = {
  onGoSettings?: () => void
}

type FormState = {
  mission_name: string
  map_suffix: string
  author: string
  network_type: 'Singleplayer' | 'Multiplayer'
  generate_scripting_environment: boolean
  game_type: GameTypeTypes
}

type GameTypeTypes = 
| 'Unknown'
| 'DM'
| 'CTF'
| 'Coop'
| 'CTI'
| 'SC'
| 'TDM'
| 'RPG'
| 'Sandbox'
| 'KOTH'
| 'LastMan'
| 'Survive'
| 'Zeus'
| 'Support'
| 'EndGame'
| 'Apex'
| 'Escape'
| 'Patrol'
| 'Vanguard'
| 'Warlords'

const initial: FormState = {
  mission_name: '',
  map_suffix: 'Altis',
  author: '',
  network_type: 'Singleplayer',
  generate_scripting_environment: false,
  game_type: 'Unknown',
}

type SettingsGate =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: LaunchpadSettings }

export function MissionBuildPage({ onGoSettings }: MissionBuildPageProps) {
  const [form, setForm] = useState<FormState>(initial)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MissionBuildResponse | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [settingsGate, setSettingsGate] = useState<SettingsGate>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void fetchSettings()
      .then((data) => {
        if (!cancelled) setSettingsGate({ status: 'ready', data })
      })
      .catch((e) => {
        if (!cancelled) {
          setSettingsGate({
            status: 'error',
            message: e instanceof Error ? e.message : 'Could not load settings',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (settingsGate.status !== 'ready') return
    const fromSettings = settingsGate.data.default_author.trim()
    if (!fromSettings) return
    setForm((f) => (f.author === '' ? { ...f, author: fromSettings } : f))
  }, [settingsGate])

  const profileReady =
    settingsGate.status === 'ready' &&
    settingsGate.data.arma3_profile_path.trim().length > 0
  const settingsBlockReason =
    settingsGate.status === 'loading'
      ? 'loading'
      : settingsGate.status === 'error'
        ? 'error'
        : !profileReady
          ? 'no_profile'
          : null

  const missionNameTrim = form.mission_name.trim()
  const mapSuffixTrim = form.map_suffix.trim()
  const missionFullNamePreview = `${missionNameTrim || 'mission_name'}.${mapSuffixTrim || 'map_suffix'}`

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setClientError(null)
    setResult(null)
    const defaultAuthorTrim =
      settingsGate.status === 'ready' ? settingsGate.data.default_author.trim() : ''
    const effectiveAuthor = form.author.trim() || defaultAuthorTrim
    if (!form.mission_name.trim() || !form.map_suffix.trim() || !effectiveAuthor) {
      setClientError(
        'Please fill in mission name and map suffix, and either author or a default author in Settings.',
      )
      return
    }
    if (!profileReady) {
      setClientError(
        'Configure your Arma 3 profile folder under Settings before building a mission.',
      )
      return
    }
    setBusy(true)
    try {
      const payload = await fetchMissionBuild({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_name: form.mission_name.trim(),
          map_suffix: form.map_suffix.trim(),
          author: effectiveAuthor,
          network_type: form.network_type,
          generate_scripting_environment: form.generate_scripting_environment,
          game_type: form.game_type,
        }),
      })
      setResult(payload)
    } catch (err) {
      setClientError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1 className="page-title">New Mission</h1>
        <p className="page-lead">
          Fill in the details below to create a new mission.
        </p>
      </header>

      <form className="card form-card" onSubmit={onSubmit}>
        <h2 className="card-title">Mission details</h2>

        {settingsGate.status === 'loading' && (
          <p className="card-body" role="status">
            Checking settings…
          </p>
        )}
        {settingsGate.status === 'error' && (
          <p className="form-banner form-banner-error" role="alert">
            {settingsGate.message} Mission build needs settings from the server.
          </p>
        )}
        {settingsBlockReason === 'no_profile' && (
          <p className="form-banner form-banner-error" role="alert">
            Set your Arma 3 profile folder in Settings (the directory that contains{' '}
            <span className="shell-inline-code">missions</span> and{' '}
            <span className="shell-inline-code">mpmissions</span>). That path is required before a
            mission can be generated.
            {onGoSettings ? (
              <>
                {' '}
                <button type="button" className="btn btn-primary" onClick={onGoSettings}>
                  Open Settings
                </button>
              </>
            ) : null}
          </p>
        )}

        <label className="field">
          <span className="field-label">Mission name</span>
          <input
            className="field-input"
            name="mission_name"
            autoComplete="off"
            placeholder="my_coop_op"
            value={form.mission_name}
            onChange={(ev) =>
              setForm((f) => ({ ...f, mission_name: ev.target.value }))
            }
          />
          <span className="field-hint">Folder name without the map suffix.</span>
        </label>

        <label className="field">
          <span className="field-label">Map suffix</span>
          <input
            className="field-input"
            name="map_suffix"
            autoComplete="off"
            placeholder="Altis"
            value={form.map_suffix}
            onChange={(ev) =>
              setForm((f) => ({ ...f, map_suffix: ev.target.value }))
            }
          />
          <span className="field-hint">
            Becomes{' '}
            <code className="shell-inline-code">{missionFullNamePreview}</code>.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Author</span>
          <input
            className="field-input"
            name="author"
            autoComplete="name"
            placeholder="Your name"
            value={form.author}
            onChange={(ev) => setForm((f) => ({ ...f, author: ev.target.value }))}
          />
        </label>

        <label className="field">
          <span className="field-label">Network Type</span>
          <select
            className="field-input"
            name="network_type"
            value={form.network_type}
            onChange={(ev) => setForm((f) => ({ ...f, network_type: ev.target.value as 'Singleplayer' | 'Multiplayer' }))}
          >
            <option value="Singleplayer">Singleplayer</option>
            <option value="Multiplayer">Multiplayer</option>
          </select>
        </label>

        <label className="field">
          <div className="field-label-container">
            <span className="field-label">Generate Scripting Environment?</span>
            <input
              type="checkbox"
              className="field-input"
              name="generate_scripting_environment"
              checked={form.generate_scripting_environment}
              onChange={(ev) => setForm((f) => ({ ...f, generate_scripting_environment: ev.target.checked }))}
            />
          </div>
          <span className="field-hint">
            Generates a scripting environment for the mission. Event scripts and a functions library will be generated.
            This is extremely useful for creating missions that require scripting, especially for beginners.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Game Type</span>
          <select 
            className="field-input"
            name="game_type"
            value={form.game_type}
            onChange={(ev) => setForm((f) => ({ ...f, game_type: ev.target.value as GameTypeTypes }))}
          >
            <option value="Unknown">Undefined Game Mode</option>
            <option value="DM">Deathmatch</option>
            <option value="CTF">Capture The Flag</option>
            <option value="Coop">Cooperative Mission</option>
            <option value="CTI">Capture The Island</option>
            <option value="SC">Sector Control</option>
            <option value="TDM">Team Deathmatch</option>
            <option value="RPG">Role-Playing Game</option>
            <option value="Sandbox">Sandbox</option>
            <option value="KOTH">King Of The Hill</option>
            <option value="LastMan">Last Man Standing</option>
            <option value="Survive">Survival</option>
            <option value="Zeus">Zeus</option>
            <option value="Support">Support</option>
            <option value="EndGame">End Game</option>
            <option value="Apex">Campaign - Apex Protocol</option>
            <option value="Escape">Escape</option>
            <option value="Patrol">Combat Patrol</option>
            <option value="Vanguard">Vanguard</option>
            <option value="Warlords">Warlords</option>
          </select>
          <span className="field-hint">
            The game type of the mission.
          </span>
        </label>

        {clientError && (
          <p className="form-banner form-banner-error" role="alert">
            {clientError}
          </p>
        )}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || settingsBlockReason !== null}
          >
            {busy ? 'Building…' : 'Build mission'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              const fallbackAuthor =
                settingsGate.status === 'ready'
                  ? settingsGate.data.default_author.trim()
                  : ''
              setForm({ ...initial, author: fallbackAuthor })
              setResult(null)
              setClientError(null)
            }}
          >
            Reset
          </button>
        </div>
      </form>

      {result && (
        <section
          className={`card result-card${result.status === 0 ? ' is-ok' : ' is-err'}`}
          aria-live="polite"
        >
          <h2 className="card-title">Response</h2>
          <dl className="result-dl">
            <div>
              <dt>Status</dt>
              <dd>{result.status === 0 ? 'Success (0)' : 'Error (1)'}</dd>
            </div>
            {result.mission_path && (
              <div>
                <dt>Mission path</dt>
                <dd>
                  <code className="shell-inline-code">{result.mission_path}</code>
                </dd>
              </div>
            )}
            {result.mission_id && (
              <div>
                <dt>Managed id</dt>
                <dd>
                  <code className="shell-inline-code">{result.mission_id}</code>
                </dd>
              </div>
            )}
            {result.error && (
              <div>
                <dt>Error</dt>
                <dd>{result.error}</dd>
              </div>
            )}
          </dl>
          {(result.messages.length > 0 || result.warnings.length > 0) && (
            <div className="result-lists">
              {result.messages.length > 0 && (
                <div>
                  <div className="result-list-title">Messages</div>
                  <ul>
                    {result.messages.map((m, i) => (
                      <li key={`m-${i}`}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.warnings.length > 0 && (
                <div>
                  <div className="result-list-title">Warnings</div>
                  <ul>
                    {result.warnings.map((w, i) => (
                      <li key={`w-${i}`}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
