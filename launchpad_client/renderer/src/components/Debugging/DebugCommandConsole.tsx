import type { DebugCommand } from '../../api/launchpad'

export type DebugPreset = {
  id: string
  name: string
  command: DebugCommand
}

type DebugCommandConsoleProps = {
  commandType: DebugCommand['type']
  commandPayloadText: string
  commandBusy: boolean
  commandErr: string | null
  presetName: string
  presets: DebugPreset[]
  onCommandTypeChange: (type: DebugCommand['type']) => void
  onCommandPayloadChange: (text: string) => void
  onPresetNameChange: (name: string) => void
  onSendCustomCommand: () => void
  onSendPing: () => void
  onClearEvents: () => void
  onSavePreset: () => void
  onLoadPreset: (preset: DebugPreset) => void
}

export function DebugCommandConsole({
  commandType,
  commandPayloadText,
  commandBusy,
  commandErr,
  presetName,
  presets,
  onCommandTypeChange,
  onCommandPayloadChange,
  onPresetNameChange,
  onSendCustomCommand,
  onSendPing,
  onClearEvents,
  onSavePreset,
  onLoadPreset,
}: DebugCommandConsoleProps) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Command console</h2>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Command type
            </span>
            <select
              className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 focus:border-accent focus:outline-none"
              value={commandType}
              onChange={(e) => onCommandTypeChange(e.target.value as DebugCommand['type'])}
            >
              <option value="ping">ping</option>
              <option value="sqf.run">sqf.run</option>
              <option value="sqf.eval">sqf.eval</option>
              <option value="mission.event">mission.event</option>
              <option value="extension.call">extension.call</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Payload (JSON object)
            </span>
            <textarea
              className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 font-mono text-[13px] text-foreground transition-[border-color] duration-100 focus:border-accent focus:outline-none"
              rows={6}
              value={commandPayloadText}
              onChange={(e) => onCommandPayloadChange(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={commandBusy}
            onClick={onSendCustomCommand}
          >
            Send command
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={commandBusy}
            onClick={onSendPing}
          >
            Send ping
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={commandBusy}
            onClick={onClearEvents}
          >
            Clear events
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 sm:max-w-xs">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Save preset
            </span>
            <input
              className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 placeholder:text-muted focus:border-accent focus:outline-none"
              value={presetName}
              onChange={(e) => onPresetNameChange(e.target.value)}
              placeholder="Preset name"
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onSavePreset}
          >
            Save preset
          </button>
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onLoadPreset(p)}
              title="Load preset"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>
      {commandErr && (
        <p className="mt-3 rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
          {commandErr}
        </p>
      )}
    </section>
  )
}
