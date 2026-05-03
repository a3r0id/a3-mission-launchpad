import type { ManagedScenario } from '../../api/launchpad'

type DebugLaunchPanelProps = {
  scenarios: ManagedScenario[]
  selectedMissionId: string
  extraArgs: string
  useCompanion: boolean
  launchBusy: boolean
  launchMsg: string | null
  launchErr: string | null
  workshopFolderSet: boolean
  onSelectMission: (id: string) => void
  onExtraArgsChange: (args: string) => void
  onUseCompanionChange: (use: boolean) => void
  onLaunchMission: () => void
}

function fullMissionName(s: ManagedScenario) {
  const base = (s.name ?? '').trim()
  const suf = (s.map_suffix ?? '').trim()
  if (!base && !suf) return '—'
  return `${base || '—'}.${suf || '—'}`
}

export function DebugLaunchPanel({
  scenarios,
  selectedMissionId,
  extraArgs,
  useCompanion,
  launchBusy,
  launchMsg,
  launchErr,
  workshopFolderSet,
  onSelectMission,
  onExtraArgsChange,
  onUseCompanionChange,
  onLaunchMission,
}: DebugLaunchPanelProps) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Mission launch (debug)</h2>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Managed mission
          </span>
          <select
            className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 focus:border-accent focus:outline-none"
            value={selectedMissionId}
            onChange={(e) => onSelectMission(e.target.value)}
            disabled={launchBusy}
          >
            <option value="">— Select —</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {fullMissionName(s)} ({s.id.slice(0, 8)}…)
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Extra arguments
          </span>
          <textarea
            className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 font-mono text-[13px] text-foreground transition-[border-color] duration-100 focus:border-accent focus:outline-none"
            rows={2}
            value={extraArgs}
            onChange={(e) => onExtraArgsChange(e.target.value)}
            disabled={launchBusy}
            spellCheck={false}
          />
          <span className="mt-1 block text-[11px] text-muted">
            {workshopFolderSet
              ? 'Mission mod names use the workshop folder from Settings (each mod is a subfolder whose name starts with @).'
              : 'Set a workshop folder in Settings so saved mission mod names resolve there.'}
          </span>
        </label>
        <label className="inline-flex items-center gap-2 text-[13px] text-foreground">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={useCompanion}
            onChange={(e) => onUseCompanionChange(e.target.checked)}
          />
          <span>Use Companion Extension</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={launchBusy}
            onClick={onLaunchMission}
          >
            Launch Mission
          </button>
        </div>
      </div>
      {launchMsg && (
        <p className="mt-3 rounded border border-success/25 bg-success/10 px-2.5 py-2 text-xs text-success" role="status">
          {launchMsg}
        </p>
      )}
      {launchErr && (
        <p className="mt-3 rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
          {launchErr}
        </p>
      )}
    </section>
  )
}
