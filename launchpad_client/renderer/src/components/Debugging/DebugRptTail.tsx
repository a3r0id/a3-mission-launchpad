import { useState } from 'react'
import { LoggingPage } from '../../pages/Logging'

type DebugRptTailProps = {
  initialShow?: boolean
}

export function DebugRptTail({ initialShow = false }: DebugRptTailProps) {
  const [showLogs, setShowLogs] = useState(initialShow)

  return (
    <>
      <section className="border-t border-border pt-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">RPT Tail</h2>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setShowLogs((v) => !v)}
        >
          {showLogs ? 'Hide log tail' : 'Show log tail'}
        </button>
      </section>
      {showLogs && <LoggingPage />}
    </>
  )
}
