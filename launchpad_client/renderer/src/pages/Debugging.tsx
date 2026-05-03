import { useCallback, useEffect, useState } from 'react'
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
import { getElectronIpc } from '../electronIpc'
import {
  DebugServerPanel,
  DebugLaunchPanel,
  DebugCommandConsole,
  DebugLiveEvents,
  DebugRptTail,
  type DebugPreset,
} from '../components/Debugging'

const LS_DEBUGGING_PRESETS = 'launchpad:debugging:presets'

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

  function onSavePreset() {
    const name = presetName.trim()
    if (!name) return
    try {
      const payload = JSON.parse(commandPayloadText) as Record<string, unknown>
      setPresets((prev) => [...prev, { id: makeId(), name, command: { type: commandType, payload } }])
      setPresetName('')
    } catch {
      setCommandErr('Cannot save preset: payload must be valid JSON object.')
    }
  }

  function onLoadPreset(preset: DebugPreset) {
    setCommandType(preset.command.type)
    setCommandPayloadText(JSON.stringify(preset.command.payload ?? {}, null, 2))
  }

  return (
    <div className="debugging-page relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <div className="flex w-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4 text-left">
        <header className="shrink-0 min-h-0 space-y-1 pb-2">
          <h1 className="m-0 text-lg font-semibold text-heading">Debugging</h1>
          <p className="m-0 text-sm text-muted">
            Launch with companion extension, run debug commands, and inspect live extension events.
          </p>
        </header>

        <div className="scrollbar-subtle flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-auto">
          <div className="w-full min-w-0 space-y-6">
            <DebugServerPanel
              server={server}
              serverBusy={serverBusy}
              serverErr={serverErr}
              onStartServer={onStartServer}
              onStopServer={onStopServer}
              onRefreshServer={refreshServer}
            />

            <DebugLaunchPanel
              scenarios={scenarios}
              selectedMissionId={selectedMissionId}
              extraArgs={extraArgs}
              useCompanion={useCompanion}
              launchBusy={launchBusy}
              launchMsg={launchMsg}
              launchErr={launchErr}
              workshopFolderSet={workshopFolderSet}
              onSelectMission={setSelectedMissionId}
              onExtraArgsChange={setExtraArgs}
              onUseCompanionChange={setUseCompanion}
              onLaunchMission={onLaunchMission}
            />

            <DebugCommandConsole
              commandType={commandType}
              commandPayloadText={commandPayloadText}
              commandBusy={commandBusy}
              commandErr={commandErr}
              presetName={presetName}
              presets={presets}
              onCommandTypeChange={setCommandType}
              onCommandPayloadChange={setCommandPayloadText}
              onPresetNameChange={setPresetName}
              onSendCustomCommand={onSendCustomCommand}
              onSendPing={() => onSendCommand({ type: 'ping', payload: { from: 'debugging-page' } })}
              onClearEvents={() => setEvents([])}
              onSavePreset={onSavePreset}
              onLoadPreset={onLoadPreset}
            />

            <DebugLiveEvents
              events={events}
              eventFilter={eventFilter}
              onEventFilterChange={setEventFilter}
            />

            <ArmaProcessMonitor />

            <DebugRptTail />
          </div>
        </div>
      </div>
    </div>
  )
}
