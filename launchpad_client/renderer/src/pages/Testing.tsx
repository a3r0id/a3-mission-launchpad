import { useCallback, useEffect, useState } from 'react'
import {
  fetchTestingAutotestResult,
  fetchManagedScenarios,
  fetchSettings,
  postTestingLaunch,
  type AutotestSpec,
  type ManagedScenario,
  type TestingAutotestDetectedResult,
} from '../api/launchpad'
import { ArmaProcessMonitor } from '../components/ArmaProcessMonitor'

const LS_MISSION = 'launchpad:testing:selectedMissionId'
const LS_EXTRA = 'launchpad:testing:extraArgs'
const LS_DEBUG = 'launchpad:testing:debugMode'
const LS_USE_EXTENSION = 'launchpad:testing:useExtension'
const AUTOTEST_POLL_MS = 2000

function readSessionBool(key: string, defaultOn: boolean): boolean {
  const raw = sessionStorage.getItem(key)
  if (raw === null) return defaultOn
  return raw === '1'
}

function fullMissionName(s: ManagedScenario) {
  const base = (s.name ?? '').trim()
  const suf = (s.map_suffix ?? '').trim()
  if (!base && !suf) return '—'
  return `${base || '—'}.${suf || '—'}`
}

export function TestingPage() {
  const [scenarios, setScenarios] = useState<ManagedScenario[]>([])
  const [selectedMissionId, setSelectedMissionId] = useState('')
  const [extraArgs, setExtraArgs] = useState(() => sessionStorage.getItem(LS_EXTRA) ?? '')
  const [debugMode, setDebugMode] = useState(() => readSessionBool(LS_DEBUG, true))
  const [useExtension, setUseExtension] = useState(() => readSessionBool(LS_USE_EXTENSION, true))
  const [autotestLabel, setAutotestLabel] = useState('')
  const [autotestIterations, setAutotestIterations] = useState('')
  const [autotestMaxDurationSec, setAutotestMaxDurationSec] = useState('')
  const [autotestTags, setAutotestTags] = useState('')
  const [enableBattleEye, setEnableBattleEye] = useState(false)

  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [autotestWatchId, setAutotestWatchId] = useState('')
  const [autotestPending, setAutotestPending] = useState(false)
  const [autotestResult, setAutotestResult] = useState<TestingAutotestDetectedResult | null>(null)
  const [autotestErr, setAutotestErr] = useState<string | null>(null)
  const [workshopFolderSet, setWorkshopFolderSet] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const list = await fetchManagedScenarios()
      setScenarios(list)
      const saved = sessionStorage.getItem(LS_MISSION)?.trim()
      if (saved && list.some((s) => s.id === saved)) {
        setSelectedMissionId(saved)
      } else if (list.length === 1) {
        setSelectedMissionId(list[0].id)
      } else if (!saved && list.length) {
        setSelectedMissionId('')
      }
      try {
        const st = await fetchSettings()
        setWorkshopFolderSet(Boolean((st.arma3_workshop_path ?? '').trim()))
      } catch {
        setWorkshopFolderSet(false)
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : 'Failed to load')
      setScenarios([])
      setWorkshopFolderSet(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    sessionStorage.setItem(LS_EXTRA, extraArgs)
  }, [extraArgs])

  useEffect(() => {
    sessionStorage.setItem(LS_DEBUG, debugMode ? '1' : '0')
  }, [debugMode])

  useEffect(() => {
    sessionStorage.setItem(LS_USE_EXTENSION, useExtension ? '1' : '0')
  }, [useExtension])

  useEffect(() => {
    const id = selectedMissionId.trim()
    if (id) sessionStorage.setItem(LS_MISSION, id)
  }, [selectedMissionId])

  useEffect(() => {
    if (!autotestWatchId.trim() || autotestResult) return
    let cancelled = false
    const poll = async () => {
      try {
        const row = await fetchTestingAutotestResult(autotestWatchId)
        if (cancelled) return
        setAutotestErr(null)
        setAutotestPending(row.active)
        if (row.complete && row.result_data) {
          setAutotestResult(row.result_data)
          setAutotestPending(false)
        } else if (!row.active && !row.complete) {
          setAutotestPending(false)
        }
      } catch (e) {
        if (cancelled) return
        setAutotestErr(e instanceof Error ? e.message : 'Could not read autotest status')
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), AUTOTEST_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [autotestWatchId, autotestResult])

  function parseAutotestSpecForLaunch(): { spec: AutotestSpec; error: string | null } {
    const spec: AutotestSpec = {}
    const lab = autotestLabel.trim()
    if (lab) spec.label = lab

    const itStr = autotestIterations.trim()
    if (itStr) {
      const it = parseInt(itStr, 10)
      if (!Number.isFinite(it) || it < 1 || it > 10_000) {
        return {
          spec: {},
          error: 'Iterations must be an integer between 1 and 10000, or leave the field empty.',
        }
      }
      spec.iterations = it
    }

    const durStr = autotestMaxDurationSec.trim()
    if (durStr) {
      const d = parseInt(durStr, 10)
      if (!Number.isFinite(d) || d < 1 || d > 864_000) {
        return {
          spec: {},
          error: 'Max duration must be between 1 and 864000 seconds, or leave the field empty.',
        }
      }
      spec.max_duration_sec = d
    }

    const tagStr = autotestTags.trim()
    if (tagStr) {
      spec.tags = tagStr
        .split(/[,;]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 32)
    }

    return { spec, error: null }
  }

  async function runLaunch(useAutotest: boolean) {
    setMsg(null)
    setErr(null)
    if (useAutotest) {
      setAutotestWatchId('')
      setAutotestPending(false)
      setAutotestResult(null)
      setAutotestErr(null)
    }
    const mid = selectedMissionId.trim()
    if (!mid) {
      setErr('Select a managed mission before launching.')
      return
    }
    let specToSend: AutotestSpec | undefined
    if (useAutotest) {
      const parsed = parseAutotestSpecForLaunch()
      if (parsed.error) {
        setErr(parsed.error)
        return
      }
      specToSend = parsed.spec
    }
    setBusy(true)
    try {
      const extra = extraArgs.trim()
      const hasDebug = /(^|\s)-debug(?=\s|$)/i.test(extra)
      const extraWithDebug = debugMode && !hasDebug ? `${extra} -debug`.trim() : extra
      const res = await postTestingLaunch({
        managed_scenario_id: mid,
        extra_args: extraWithDebug || undefined,
        use_companion_extension: useExtension,
        autotest: useAutotest,
        ...(specToSend !== undefined ? { autotest_spec: specToSend } : {}),
      })
      if ('error' in res) {
        setErr(res.error)
        return
      }
      let line =
        res.message ?? `Started (PID ${res.pid}). Mission folder: ${res.missionFolderName}`
      if (res.autotestFilePath) {
        line += ` Autotest file: ${res.autotestFilePath}`
      }
      setMsg(line)
      if (useAutotest) {
        if (res.autotestWatchId) {
          setAutotestWatchId(res.autotestWatchId)
          setAutotestPending(true)
        } else {
          setAutotestPending(false)
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Launch failed')
    } finally {
      setBusy(false)
    }
  }

  const selectedMission = scenarios.find((s) => s.id === selectedMissionId)

  return (
    <div className="page-stack testing-page">
      {/* <header className="page-header">
        <h1 className="page-title">Testing</h1>
        <p className="page-lead">
          Benchmark and audit your mission.
        </p>
      </header> */}

      {loading ? (
        <p className="card-body">Loading…</p>
      ) : loadErr ? (
        <p className="form-banner form-banner-error" role="alert">
          {loadErr}
        </p>
      ) : null}

      {!loading && !loadErr ? (
        <>
          <section className="card testing-card">
            {/* <h2 className="card-title">Launch setup</h2> */}
            {/* <p className="card-body" style={{ marginTop: 0 }}>
              Pick mission startup options for this session.
            </p> */}
            <div className="testing-launch-grid">
              <div className="testing-launch-main">
                <label className="field">
                  <span className="field-label">Managed mission</span>
                  <select
                    className="field-input"
                    value={selectedMissionId}
                    onChange={(e) => setSelectedMissionId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">— Select —</option>
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {fullMissionName(s)} ({s.id.slice(0, 8)}…)
                      </option>
                    ))}
                  </select>
                </label>
                {selectedMission ? (
                  <p className="field-hint testing-mission-hint">
                    Arma mission folder:{' '}
                    <code className="shell-inline-code">
                      {(selectedMission.name ?? '').trim()}.{(selectedMission.map_suffix ?? '').trim()}
                    </code>
                  </p>
                ) : null}
                <label className="field">
                  <span className="field-label">Extra arguments</span>
                  <textarea
                    className="field-input testing-textarea"
                    rows={3}
                    value={extraArgs}
                    onChange={(e) => setExtraArgs(e.target.value)}
                    disabled={busy}
                    placeholder={'-skipIntro -showScriptErrors -filePatching'}
                    spellCheck={false}
                  />
                  <span className="field-hint">
                    Optional. Split like a shell command (quotes allowed). Passed after{' '}
                    <code className="shell-inline-code">-mod=</code>.
                    {workshopFolderSet
                      ? ' Mission mod names use the workshop folder from Settings (each mod is a subfolder whose name starts with @).'
                      : ' Set a workshop folder in Settings so saved mission mod names resolve there.'}
                  </span>
                </label>
                <div className="testing-toggle-list">
                  <label className="testing-inline-toggle">
                    <input
                      type="checkbox"
                      checked={debugMode}
                      onChange={(e) => setDebugMode(e.target.checked)}
                      disabled={busy}
                    />
                    <span>
                      Enable debug mode <code className="shell-inline-code">-debug</code>
                    </span>
                  </label>
                  <label className="testing-inline-toggle">
                    <input
                      type="checkbox"
                      checked={useExtension}
                      onChange={(e) => setUseExtension(e.target.checked)}
                      disabled={busy}
                    />
                    <span>
                      Use Companion Extension{' '}
                      <span
                        className="shell-inline-code badge badge-info"
                        title="When enabled, your client will launch with our companion mod. In most Launchpad testing cases this should be enabled."
                      >
                        ?
                      </span>
                    </span>
                  </label>
                  <label className="testing-inline-toggle">
                    <input
                      type="checkbox"
                      checked={enableBattleEye}
                      onChange={(e) => setEnableBattleEye(e.target.checked)}
                      disabled={busy}
                    />
                    <span>
                      Enable BattleEye{' '}
                      <span
                        className="shell-inline-code badge badge-info"
                        title="When enabled, your client will launch with BattleEye enabled. In most Launchpad testing cases this should be disabled."
                      >
                        ?
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <fieldset className="testing-autotest-fieldset">
                <legend className="field-label">Autotest</legend>
                <p className="field-hint testing-autotest-hint">
                  <strong>Launch an Autotest</strong>. See{' '}
                  <a
                    href="https://community.bistudio.com/wiki/Arma_3:_Startup_Parameters#autotest"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    the wiki
                  </a>
                  .
                </p>
                <label className="field">
                  <span className="field-label">Run label</span>
                  <input
                    className="field-input"
                    value={autotestLabel}
                    onChange={(e) => setAutotestLabel(e.target.value)}
                    disabled={busy}
                    placeholder="e.g. smoke / benchmark A"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <span className="field-hint">
                    Optional. Used for naming the autotest file.
                  </span>
                </label>
                <div className="testing-autotest-row">
                  <label className="field">
                    <span className="field-label">Iterations</span>
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={10000}
                      inputMode="numeric"
                      value={autotestIterations}
                      onChange={(e) => setAutotestIterations(e.target.value)}
                      disabled={busy}
                      placeholder="3"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Max sec</span>
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={864000}
                      inputMode="numeric"
                      value={autotestMaxDurationSec}
                      onChange={(e) => setAutotestMaxDurationSec(e.target.value)}
                      disabled={busy}
                      placeholder="600"
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">Tags (optional)</span>
                  <input
                    className="field-input"
                    value={autotestTags}
                    onChange={(e) => setAutotestTags(e.target.value)}
                    disabled={busy}
                    placeholder="Comma or semicolon separated"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              </fieldset>
            </div>

            <div className="testing-launch-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void runLaunch(false)}>
                Launch Mission
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void runLaunch(true)}>
                Launch Mission (Autotest)
              </button>
            </div>
            {autotestPending ? (
              <p className="form-banner form-banner-warning" role="status">
                Waiting for autotest result…
              </p>
            ) : null}
            {autotestErr ? (
              <p className="form-banner form-banner-error" role="alert">
                {autotestErr}
              </p>
            ) : null}
            {autotestResult ? (
              <div
                className={`form-banner ${
                  autotestResult.result.trim().toUpperCase() === 'FAILED'
                    ? 'form-banner-error'
                    : 'form-banner-success'
                }`}
                role="status"
              >
                <strong>Autotest {autotestResult.result || 'completed'}.</strong>{' '}
                {autotestResult.end_mode ? `End mode: ${autotestResult.end_mode}. ` : ''}
                {autotestResult.mission ? `Mission: ${autotestResult.mission}.` : ''}
              </div>
            ) : null}
            {msg ? (
              <p className="form-banner form-banner-success" role="status">
                {msg}
              </p>
            ) : null}
            {err ? (
              <p className="form-banner form-banner-error" role="alert">
                {err}
              </p>
            ) : null}
          </section>

          <ArmaProcessMonitor />
        </>
      ) : null}
    </div>
  )
}
