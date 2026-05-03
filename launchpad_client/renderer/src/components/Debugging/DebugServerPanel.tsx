import type { DebugServerState } from '../../api/launchpad'

type DebugServerPanelProps = {
  server: DebugServerState
  serverBusy: boolean
  serverErr: string | null
  onStartServer: () => void
  onStopServer: () => void
  onRefreshServer: () => void
}

export function DebugServerPanel({
  server,
  serverBusy,
  serverErr,
  onStartServer,
  onStopServer,
  onRefreshServer,
}: DebugServerPanelProps) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Extension socket</h2>
      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Host</span>
          <span className="font-medium text-foreground">{server.host}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Port</span>
          <span className="font-medium text-foreground">{server.port}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Server</span>
          <span className={server.listening ? 'font-medium text-success' : 'font-medium text-muted'}>
            {server.listening ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Client</span>
          <span className={server.connected ? 'font-medium text-success' : 'font-medium text-muted'}>
            {server.connected ? server.clientAddress ?? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Sent</span>
          <span className="font-medium text-foreground">{server.messagesSent}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted">Received</span>
          <span className="font-medium text-foreground">{server.messagesReceived}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={serverBusy}
          onClick={onStartServer}
        >
          Start server
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={serverBusy}
          onClick={onStopServer}
        >
          Stop server
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={serverBusy}
          onClick={onRefreshServer}
        >
          Refresh status
        </button>
      </div>
      {server.lastError && (
        <p className="mt-3 rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
          {server.lastError}
        </p>
      )}
      {serverErr && (
        <p className="mt-3 rounded border border-danger/25 bg-danger/10 px-2.5 py-2 text-xs text-danger" role="alert">
          {serverErr}
        </p>
      )}
    </section>
  )
}
