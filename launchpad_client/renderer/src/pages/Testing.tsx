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
import { TestingLaunchSetup, TestingAutotest } from '../components/Testing'

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

  return (
    <div className="testing-page relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <div className="flex w-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4 text-left">
        <header className="shrink-0 min-h-0 space-y-1 pb-2">
          <h1 className="m-0 text-lg font-semibold text-heading">Testing</h1>
          <p className="m-0 text-sm text-muted">
            Benchmark and audit your mission.
          </p>
        </header>

        <div className="scrollbar-subtle flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-auto">
          <div className="w-full min-w-0 space-y-6">
            {loading && (
              <p className="py-6 text-center text-sm text-muted">Loading…</p>
            )}

            {loadErr && (
              <p className="rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
                {loadErr}
              </p>
            )}

            {!loading && !loadErr && (
              <>
                <TestingLaunchSetup
                  scenarios={scenarios}
                  selectedMissionId={selectedMissionId}
                  extraArgs={extraArgs}
                  debugMode={debugMode}
                  useExtension={useExtension}
                  enableBattleEye={enableBattleEye}
                  busy={busy}
                  workshopFolderSet={workshopFolderSet}
                  onSelectMission={setSelectedMissionId}
                  onExtraArgsChange={setExtraArgs}
                  onDebugModeChange={setDebugMode}
                  onUseExtensionChange={setUseExtension}
                  onEnableBattleEyeChange={setEnableBattleEye}
                />

                <TestingAutotest
                  autotestLabel={autotestLabel}
                  autotestIterations={autotestIterations}
                  autotestMaxDurationSec={autotestMaxDurationSec}
                  autotestTags={autotestTags}
                  busy={busy}
                  autotestPending={autotestPending}
                  autotestResult={autotestResult}
                  autotestErr={autotestErr}
                  onAutotestLabelChange={setAutotestLabel}
                  onAutotestIterationsChange={setAutotestIterations}
                  onAutotestMaxDurationSecChange={setAutotestMaxDurationSec}
                  onAutotestTagsChange={setAutotestTags}
                  onParseSpec={parseAutotestSpecForLaunch}
                />

                <section className="border-t border-border pt-6">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void runLaunch(false)}
                    >
                      Launch Mission
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void runLaunch(true)}
                    >
                      Launch Mission (Autotest)
                    </button>
                  </div>
                  {msg && (
                    <p className="mt-3 rounded border border-success/25 bg-success/10 px-2.5 py-2 text-xs text-success" role="status">
                      {msg}
                    </p>
                  )}
                  {err && (
                    <p className="mt-3 rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
                      {err}
                    </p>
                  )}
                </section>

                <ArmaProcessMonitor />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
