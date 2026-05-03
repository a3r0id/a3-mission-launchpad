import type { DebugEvent } from '../../api/launchpad'

type DebugLiveEventsProps = {
  events: DebugEvent[]
  eventFilter: string
  onEventFilterChange: (filter: string) => void
}

export function DebugLiveEvents({
  events,
  eventFilter,
  onEventFilterChange,
}: DebugLiveEventsProps) {
  const filteredEvents = (() => {
    const q = eventFilter.trim().toLowerCase()
    if (!q) return events
    return events.filter((e) => {
      const text = `${e.type} ${JSON.stringify(e.payload ?? {})}`.toLowerCase()
      return text.includes(q)
    })
  })()

  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Live events</h2>
      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
          Filter
        </span>
        <input
          className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 placeholder:text-muted focus:border-accent focus:outline-none sm:max-w-sm"
          value={eventFilter}
          onChange={(e) => onEventFilterChange(e.target.value)}
          placeholder="Type/payload filter"
        />
      </label>
      <pre className="scrollbar-subtle max-h-64 overflow-auto rounded-md border border-border bg-subtle p-3 font-mono text-[12px] text-foreground" aria-live="polite">
        {filteredEvents.length
          ? filteredEvents
              .slice(-200)
              .map((e) => `[${new Date(e.ts * 1000).toLocaleTimeString()}] [${e.direction}] ${e.type} ${JSON.stringify(e.payload ?? e.raw ?? {})}`)
              .join('\n')
          : 'No events yet.'}
      </pre>
    </section>
  )
}
