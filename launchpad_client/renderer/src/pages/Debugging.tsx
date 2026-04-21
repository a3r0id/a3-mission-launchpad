import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchManagedScenarios,
  fetchDebugServerStatus,
  fetchSettings,
  postDebugCommandSend,
  postDebugServerStart,
  postDebugServerStop,
  postTestingLaunch,
  type DebugCommand,
  type DebugServerState,
  type ManagedScenario,
  type DebugEvent,
} from '../api/launchpad'
import { ArmaProcessMonitor } from '../components/ArmaProcessMonitor'
import { LoggingPage } from './Logging'
import { getElectronIpc } from '../electronIpc'

const LS_DEBUGGING_PRESETS = 'launchpad:debugging:presets'

type DebugPreset = {
  id: string
  name: string
  command: DebugCommand
}

const initialServerState: DebugServerState = {
  host: '127.0.0.1',
  port: 8112,
  listening: false,
  connected: false,
  clientAddress: null,
  messagesSent: 0,
  messagesReceived: 0,
  lastError: null,
}

function fullMissionName(s: ManagedScenario) {
  const base = (s.name ?? '').trim()
  const suf = (s.map_suffix ?? '').trim()
  if (!base && !suf) return '—'
  return `${base || '—'}.${suf || '—'}`
}

function makeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function DebuggingPage() {
  const [server, setServer] = useState<DebugServerState>(initialServerState)
  const [serverBusy, setServerBusy] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)

  const [scenarios, setScenarios] = useState<ManagedScenario[]>([])
  const [selectedMissionId, setSelectedMissionId] = useState('')
  const [extraArgs, setExtraArgs] = useState('-showScriptErrors -filePatching')
  const [useCompanion, setUseCompanion] = useState(true)
  const [launchBusy, setLaunchBusy] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<string | null>(null)
  const [launchErr, setLaunchErr] = useState<string | null>(null)

  const [commandType, setCommandType] = useState<DebugCommand['type']>('ping')
  const [commandPayloadText, setCommandPayloadText] = useState('{\n  "message": "hello"\n}')
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandErr, setCommandErr] = useState<string | null>(null)
  const [events, setEvents] = useState<DebugEvent[]>([])
  const [eventFilter, setEventFilter] = useState('')

  const [presetName, setPresetName] = useState('')
  const [presets, setPresets] = useState<DebugPreset[]>(() => {
    try {
      const raw = localStorage.getItem(LS_DEBUGGING_PRESETS) ?? '[]'
      const parsed = JSON.parse(raw) as DebugPreset[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [showLogs, setShowLogs] = useState(false)
  const [workshopFolderSet, setWorkshopFolderSet] = useState(false)

  useEffect(() => {
    localStorage.setItem(LS_DEBUGGING_PRESETS, JSON.stringify(presets))
  }, [presets])

  const refreshServer = useCallback(async () => {
    try {
      const st = await fetchDebugServerStatus()
      setServer(st)
    } catch (e) {
      setServerErr(e instanceof Error ? e.message : 'Could not read debug server status.')
    }
  }, [])

  useEffect(() => {
    void refreshServer()
    void fetchManagedScenarios()
      .then((rows) => {
        setScenarios(rows)
        if (rows.length === 1) setSelectedMissionId(rows[0].id)
      })
      .catch(() => {})
    void fetchSettings()
      .then((st) => setWorkshopFolderSet(Boolean((st.arma3_workshop_path ?? '').trim())))
      .catch(() => setWorkshopFolderSet(false))
  }, [refreshServer])

  useEffect(() => {
    const ipc = getElectronIpc()
    if (!ipc) return
    const onState = (_evt: unknown, ...args: unknown[]) => {
      const state = args[0] as DebugServerState | undefined
      if (state) setServer(state)
    }
    const onEvent = (_evt: unknown, ...args: unknown[]) => {
      const event = args[0] as DebugEvent | undefined
      if (!event) return
      setEvents((prev) => [...prev.slice(-399), event])
    }
    ipc.on('debug-socket-state', onState)
    ipc.on('debug-event', onEvent)
    return () => {
      ipc.removeListener('debug-socket-state', onState)
      ipc.removeListener('debug-event', onEvent)
    }
  }, [])

  async function onStartServer() {
    setServerBusy(true)
    setServerErr(null)
    try {
      const st = await postDebugServerStart(server.host, server.port)
      setServer(st)
    } catch (e) {
      setServerErr(e instanceof Error ? e.message : 'Could not start debug server.')
    } finally {
      setServerBusy(false)
    }
  }

  async function onStopServer() {
    setServerBusy(true)
    setServerErr(null)
    try {
      const st = await postDebugServerStop()
      setServer(st)
    } catch (e) {
      setServerErr(e instanceof Error ? e.message : 'Could not stop debug server.')
    } finally {
      setServerBusy(false)
    }
  }

  async function onLaunchMission() {
    setLaunchErr(null)
    setLaunchMsg(null)
    const missionId = selectedMissionId.trim()
    if (!missionId) {
      setLaunchErr('Select a mission first.')
      return
    }
    setLaunchBusy(true)
    try {
      const res = await postTestingLaunch({
        managed_scenario_id: missionId,
        extra_args: extraArgs.trim() || undefined,
        use_companion_extension: useCompanion,
      })
      if ('error' in res) {
        setLaunchErr(res.error)
      } else {
        setLaunchMsg(res.message ?? `Started (PID ${res.pid}).`)
      }
    } catch (e) {
      setLaunchErr(e instanceof Error ? e.message : 'Launch failed.')
    } finally {
      setLaunchBusy(false)
    }
  }

  async function onSendCommand(command: DebugCommand) {
    setCommandErr(null)
    setCommandBusy(true)
    try {
      const st = await postDebugCommandSend(command)
      setServer(st)
    } catch (e) {
      setCommandErr(e instanceof Error ? e.message : 'Could not send debug command.')
    } finally {
      setCommandBusy(false)
    }
  }

  async function onSendCustomCommand() {
    let parsedPayload: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(commandPayloadText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Payload must be a JSON object.')
      }
      parsedPayload = parsed as Record<string, unknown>
    } catch (e) {
      setCommandErr(e instanceof Error ? e.message : 'Invalid JSON payload.')
      return
    }
    await onSendCommand({
      type: commandType,
      payload: parsedPayload,
    })
  }

  const filteredEvents = useMemo(() => {
    const q = eventFilter.trim().toLowerCase()
    if (!q) return events
    return events.filter((e) => {
      const text = `${e.type} ${JSON.stringify(e.payload ?? {})}`.toLowerCase()
      return text.includes(q)
    })
  }, [events, eventFilter])

  return (
    <div className="page-stack">
      {/* <header className="page-header">
        <h1 className="page-title">Debugging</h1>
        <p className="page-lead">Launch with companion extension, run debug commands, and inspect live extension events.</p>
      </header> */}

      <section className="card form-card">
        <h2 className="card-title">Extension socket</h2>
        <div className="logging-meta-grid">
          <div><strong>Host:</strong> {server.host}</div>
          <div><strong>Port:</strong> {server.port}</div>
          <div><strong>Server:</strong> {server.listening ? 'Running' : 'Stopped'}</div>
          <div><strong>Client:</strong> {server.connected ? server.clientAddress ?? 'Connected' : 'Disconnected'}</div>
          <div><strong>Sent:</strong> {server.messagesSent}</div>
          <div><strong>Received:</strong> {server.messagesReceived}</div>
        </div>
        <div className="testing-launch-actions">
          <button type="button" className="btn btn-primary" disabled={serverBusy} onClick={() => void onStartServer()}>
            Start server
          </button>
          <button type="button" className="btn btn-ghost" disabled={serverBusy} onClick={() => void onStopServer()}>
            Stop server
          </button>
          <button type="button" className="btn btn-ghost" disabled={serverBusy} onClick={() => void refreshServer()}>
            Refresh status
          </button>
        </div>
        {server.lastError ? <p className="form-banner form-banner-error" role="alert">{server.lastError}</p> : null}
        {serverErr ? <p className="form-banner form-banner-error" role="alert">{serverErr}</p> : null}
      </section>

      <section className="card form-card">
        <h2 className="card-title">Mission launch (debug)</h2>
        <label className="field">
          <span className="field-label">Managed mission</span>
          <select className="field-input" value={selectedMissionId} onChange={(e) => setSelectedMissionId(e.target.value)} disabled={launchBusy}>
            <option value="">— Select —</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {fullMissionName(s)} ({s.id.slice(0, 8)}…)
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Extra arguments</span>
          <textarea
            className="field-input testing-textarea"
            rows={2}
            value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            disabled={launchBusy}
            spellCheck={false}
          />
          <span className="field-hint">
            {workshopFolderSet
              ? 'Mission mod names use the workshop folder from Settings (each mod is a subfolder whose name starts with @).'
              : 'Set a workshop folder in Settings so saved mission mod names resolve there.'}
          </span>
        </label>
        <label className="testing-inline-toggle">
          <input type="checkbox" checked={useCompanion} onChange={(e) => setUseCompanion(e.target.checked)} />
          <span>Use Companion Extension</span>
        </label>
        <div className="testing-launch-actions">
          <button type="button" className="btn btn-primary" disabled={launchBusy} onClick={() => void onLaunchMission()}>
            Launch Mission
          </button>
        </div>
        {launchMsg ? <p className="form-banner form-banner-success" role="status">{launchMsg}</p> : null}
        {launchErr ? <p className="form-banner form-banner-error" role="alert">{launchErr}</p> : null}
      </section>

      <section className="card form-card">
        <h2 className="card-title">Command console</h2>
        <div className="testing-launch-grid">
          <label className="field" style={{ width: '100%' }}>
            <span className="field-label">Command type</span>
            <select className="field-input" value={commandType} onChange={(e) => setCommandType(e.target.value)}>
              <option value="ping">ping</option>
              <option value="sqf.run">sqf.run</option>
              <option value="sqf.eval">sqf.eval</option>
              <option value="mission.event">mission.event</option>
              <option value="extension.call">extension.call</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="field" style={{ width: '100%' }}>
            <span className="field-label">Payload (JSON object)</span>
            <textarea
              className="field-input testing-textarea"
              rows={6}
              value={commandPayloadText}
              onChange={(e) => setCommandPayloadText(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="testing-launch-actions">
          <button type="button" className="btn btn-primary" disabled={commandBusy} onClick={() => void onSendCustomCommand()}>
            Send command
          </button>
          <button type="button" className="btn btn-ghost" disabled={commandBusy} onClick={() => void onSendCommand({ type: 'ping', payload: { from: 'debugging-page' } })}>
            Send ping
          </button>
          <button type="button" className="btn btn-ghost" disabled={commandBusy} onClick={() => setEvents([])}>
            Clear events
          </button>
        </div>
        <div className="testing-launch-grid">
          <label className="field">
            <span className="field-label">Save preset</span>
            <input className="field-input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" />
          </label>
        </div>
        <div className="testing-launch-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const name = presetName.trim()
              if (!name) return
              try {
                const payload = JSON.parse(commandPayloadText) as Record<string, unknown>
                setPresets((prev) => [...prev, { id: makeId(), name, command: { type: commandType, payload } }])
                setPresetName('')
              } catch {
                setCommandErr('Cannot save preset: payload must be valid JSON object.')
              }
            }}
          >
            Save preset
          </button>
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setCommandType(p.command.type)
                setCommandPayloadText(JSON.stringify(p.command.payload ?? {}, null, 2))
              }}
              title="Load preset"
            >
              {p.name}
            </button>
          ))}
        </div>
        {commandErr ? <p className="form-banner form-banner-error" role="alert">{commandErr}</p> : null}
      </section>

      <section className="card form-card">
        <h2 className="card-title">Live events</h2>
        <label className="field">
          <span className="field-label">Filter</span>
          <input className="field-input" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} placeholder="Type/payload filter" />
        </label>
        <pre className="pbo-build-log" aria-live="polite">
          {filteredEvents.length
            ? filteredEvents
                .slice(-200)
                .map((e) => `[${new Date(e.ts * 1000).toLocaleTimeString()}] [${e.direction}] ${e.type} ${JSON.stringify(e.payload ?? e.raw ?? {})}`)
                .join('\n')
            : 'No events yet.'}
        </pre>
      </section>

      <ArmaProcessMonitor />

      <section className="card form-card">
        <h2 className="card-title">RPT Tail</h2>
        <button type="button" className="btn btn-ghost" onClick={() => setShowLogs((v) => !v)}>
          {showLogs ? 'Hide log tail' : 'Show log tail'}
        </button>
      </section>

      {showLogs ? <LoggingPage /> : null}
    </div>
  )
}
