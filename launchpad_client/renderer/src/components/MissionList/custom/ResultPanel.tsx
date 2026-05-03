import type { MissionBuildResponse } from '../../../api/launchpad'
import { CodeInline } from './CodeInline'

type Props = {
  result: MissionBuildResponse
  compact?: boolean
}

export function ResultPanel({ result, compact }: Props) {
  const ok = result.status === 0
  return (
    <section
      className={`rounded-md border px-3 py-3 ${
        ok
          ? 'border-success/30 bg-success/10'
          : 'border-danger/30 bg-danger/10'
      } ${compact ? 'text-sm' : ''}`}
      aria-live="polite"
    >
      <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Build result</h3>
      <dl className="m-0 space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="m-0 text-muted">Status</dt>
          <dd className="m-0 font-medium text-heading">
            {ok ? 'Success' : 'Error'}
          </dd>
        </div>
        {result.mission_path ? (
          <div>
            <dt className="m-0 text-xs text-muted">Path</dt>
            <dd className="m-0 mt-0.5 break-all">
              <CodeInline>{result.mission_path}</CodeInline>
            </dd>
          </div>
        ) : null}
        {result.mission_id ? (
          <div>
            <dt className="m-0 text-xs text-muted">Id</dt>
            <dd className="m-0 mt-0.5">
              <CodeInline>{result.mission_id}</CodeInline>
            </dd>
          </div>
        ) : null}
        {result.error ? (
          <div>
            <dt className="m-0 text-xs text-muted">Error</dt>
            <dd className="m-0 mt-0.5 text-heading">{result.error}</dd>
          </div>
        ) : null}
      </dl>
      {(result.messages.length > 0 || result.warnings.length > 0) && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs text-foreground">
          {result.messages.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-heading">Messages</div>
              <ul className="m-0 list-inside list-disc space-y-0.5 pl-0 text-muted">
                {result.messages.map((m, i) => (
                  <li key={`m-${i}`}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <div className="mb-1 font-semibold text-heading">Warnings</div>
              <ul className="m-0 list-inside list-disc space-y-0.5 pl-0 text-muted">
                {result.warnings.map((w, i) => (
                  <li key={`w-${i}`}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
