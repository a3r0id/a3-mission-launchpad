import type { AutotestSpec, TestingAutotestDetectedResult } from '../../api/launchpad'

type TestingAutotestProps = {
  autotestLabel: string
  autotestIterations: string
  autotestMaxDurationSec: string
  autotestTags: string
  busy: boolean
  autotestPending: boolean
  autotestResult: TestingAutotestDetectedResult | null
  autotestErr: string | null
  onAutotestLabelChange: (value: string) => void
  onAutotestIterationsChange: (value: string) => void
  onAutotestMaxDurationSecChange: (value: string) => void
  onAutotestTagsChange: (value: string) => void
  onParseSpec: () => { spec: AutotestSpec; error: string | null }
}

export function TestingAutotest({
  autotestLabel,
  autotestIterations,
  autotestMaxDurationSec,
  autotestTags,
  busy,
  autotestPending,
  autotestResult,
  autotestErr,
  onAutotestLabelChange,
  onAutotestIterationsChange,
  onAutotestMaxDurationSecChange,
  onAutotestTagsChange,
}: TestingAutotestProps) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Autotest</h2>
      <p className="mb-3 text-[11px] text-muted">
        <strong className="text-foreground">Launch an Autotest</strong>. See{' '}
        <a
          href="https://community.bistudio.com/wiki/Arma_3:_Startup_Parameters#autotest"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          the wiki
        </a>
        .
      </p>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Run label
          </span>
          <input
            className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 placeholder:text-muted focus:border-accent focus:outline-none"
            value={autotestLabel}
            onChange={(e) => onAutotestLabelChange(e.target.value)}
            disabled={busy}
            placeholder="e.g. smoke / benchmark A"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="mt-1 block text-[11px] text-muted">
            Optional. Used for naming the autotest file.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Iterations
            </span>
            <input
              className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 placeholder:text-muted focus:border-accent focus:outline-none"
              type="number"
              min={1}
              max={10000}
              inputMode="numeric"
              value={autotestIterations}
              onChange={(e) => onAutotestIterationsChange(e.target.value)}
              disabled={busy}
              placeholder="3"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Max sec
            </span>
            <input
              className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 placeholder:text-muted focus:border-accent focus:outline-none"
              type="number"
              min={1}
              max={864000}
              inputMode="numeric"
              value={autotestMaxDurationSec}
              onChange={(e) => onAutotestMaxDurationSecChange(e.target.value)}
              disabled={busy}
              placeholder="600"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Tags (optional)
          </span>
          <input
            className="w-full rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[13px] text-foreground transition-[border-color] duration-100 placeholder:text-muted focus:border-accent focus:outline-none"
            value={autotestTags}
            onChange={(e) => onAutotestTagsChange(e.target.value)}
            disabled={busy}
            placeholder="Comma or semicolon separated"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
      </div>

      {autotestPending && (
        <p className="mt-3 rounded border border-warning/25 bg-warning/10 px-2.5 py-2 text-xs text-warning" role="status">
          Waiting for autotest result…
        </p>
      )}
      {autotestErr && (
        <p className="mt-3 rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
          {autotestErr}
        </p>
      )}
      {autotestResult && (
        <div
          className={`mt-3 rounded border px-2.5 py-2 text-xs ${
            autotestResult.result.trim().toUpperCase() === 'FAILED'
              ? 'border-danger/25 bg-danger/10 text-danger'
              : 'border-success/25 bg-success/10 text-success'
          }`}
          role="status"
        >
          <strong>Autotest {autotestResult.result || 'completed'}.</strong>{' '}
          {autotestResult.end_mode ? `End mode: ${autotestResult.end_mode}. ` : ''}
          {autotestResult.mission ? `Mission: ${autotestResult.mission}.` : ''}
        </div>
      )}
    </section>
  )
}
