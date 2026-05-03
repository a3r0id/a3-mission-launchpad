import type { ManagedScenario } from '../../api/launchpad'

type TestingLaunchSetupProps = {
  scenarios: ManagedScenario[]
  selectedMissionId: string
  extraArgs: string
  debugMode: boolean
  useExtension: boolean
  enableBattleEye: boolean
  busy: boolean
  workshopFolderSet: boolean
  onSelectMission: (id: string) => void
  onExtraArgsChange: (args: string) => void
  onDebugModeChange: (enabled: boolean) => void
  onUseExtensionChange: (enabled: boolean) => void
  onEnableBattleEyeChange: (enabled: boolean) => void
}

function fullMissionName(s: ManagedScenario) {
  const base = (s.name ?? '').trim()
  const suf = (s.map_suffix ?? '').trim()
  if (!base && !suf) return '—'
  return `${base || '—'}.${suf || '—'}`
}

export function TestingLaunchSetup({
  scenarios,
  selectedMissionId,
  extraArgs,
  debugMode,
  useExtension,
  enableBattleEye,
  busy,
  workshopFolderSet,
  onSelectMission,
  onExtraArgsChange,
  onDebugModeChange,
  onUseExtensionChange,
  onEnableBattleEyeChange,
}: TestingLaunchSetupProps) {
  const selectedMission = scenarios.find((s) => s.id === selectedMissionId)

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Launch setup</h2>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Managed mission
          </span>
          <select
            className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 focus:border-accent focus:outline-none"
            value={selectedMissionId}
            onChange={(e) => onSelectMission(e.target.value)}
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

        {selectedMission && (
          <p className="text-[11px] text-muted">
            Arma mission folder:{' '}
            <code className="rounded bg-app px-1 font-mono text-[12px] text-heading ring-1 ring-inset ring-border">
              {(selectedMission.name ?? '').trim()}.{(selectedMission.map_suffix ?? '').trim()}
            </code>
          </p>
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Extra arguments
          </span>
          <textarea
            className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 font-mono text-[13px] text-foreground transition-[border-color] duration-100 focus:border-accent focus:outline-none"
            rows={3}
            value={extraArgs}
            onChange={(e) => onExtraArgsChange(e.target.value)}
            disabled={busy}
            placeholder="-skipIntro -showScriptErrors -filePatching"
            spellCheck={false}
          />
          <span className="mt-1 block text-[11px] text-muted">
            Optional. Split like a shell command (quotes allowed). Passed after{' '}
            <code className="rounded bg-app px-1 font-mono text-[12px] text-heading ring-1 ring-inset ring-border">-mod=</code>.
            {workshopFolderSet
              ? ' Mission mod names use the workshop folder from Settings (each mod is a subfolder whose name starts with @).'
              : ' Set a workshop folder in Settings so saved mission mod names resolve there.'}
          </span>
        </label>

        <div className="space-y-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              className="rounded border-border"
              checked={debugMode}
              onChange={(e) => onDebugModeChange(e.target.checked)}
              disabled={busy}
            />
            <span>
              Enable debug mode <code className="rounded bg-app px-1 font-mono text-[12px] text-heading ring-1 ring-inset ring-border">-debug</code>
            </span>
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              className="rounded border-border"
              checked={useExtension}
              onChange={(e) => onUseExtensionChange(e.target.checked)}
              disabled={busy}
            />
            <span>
              Use Companion Extension{' '}
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent"
                title="When enabled, your client will launch with our companion mod. In most Launchpad testing cases this should be enabled."
              >
                ?
              </span>
            </span>
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              className="rounded border-border"
              checked={enableBattleEye}
              onChange={(e) => onEnableBattleEyeChange(e.target.checked)}
              disabled={busy}
            />
            <span>
              Enable BattleEye{' '}
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent/10 text-[10px] font-semibold text-accent"
                title="When enabled, your client will launch with BattleEye enabled. In most Launchpad testing cases this should be disabled."
              >
                ?
              </span>
            </span>
          </label>
        </div>
      </div>
    </section>
  )
}
