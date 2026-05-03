import type { RemoteServerSettingsEntry } from '../../api/launchpad'
import { settings } from './settingsClasses'
import { SettingsCard } from './SettingsCard'

type Props = {
  loading: boolean
  remoteServers: RemoteServerSettingsEntry[]
  remoteDefaultServerId: string
  remoteDefaultFolder: string
  onDefaultServer: (v: string) => void
  onDefaultFolder: (v: string) => void
  onAdd: () => void
  onEdit: (row: RemoteServerSettingsEntry) => void
  onRemove: (id: string) => void
}

export function SettingsRemoteServersSection({
  loading,
  remoteServers,
  remoteDefaultServerId,
  remoteDefaultFolder,
  onDefaultServer,
  onDefaultFolder,
  onAdd,
  onEdit,
  onRemove,
}: Props) {
  return (
    <SettingsCard
      sectionId="remote-servers-heading"
      title="Remote servers"
      lead="Store SSH host details for remote log browsing. Passwords and passphrases are not saved and are asked when you connect. Use Save at the bottom when you are done."
    >
      {loading ? (
        <p className={settings.cardBody}>Loading…</p>
      ) : (
        <>
          <label className={settings.field}>
            <span className={settings.label}>Default server for remote logs</span>
            <div className="relative">
              <select
                className={settings.select}
                value={remoteDefaultServerId}
                onChange={(e) => onDefaultServer(e.target.value)}
              >
                <option value="">None selected</option>
                {remoteServers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} ({row.username}@{row.host}:{row.port})
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted"
                aria-hidden
              >
                ▼
              </span>
            </div>
          </label>
          <label className={settings.field}>
            <span className={settings.label}>Default remote logs folder</span>
            <input
              className={settings.input}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={remoteDefaultFolder}
              onChange={(e) => onDefaultFolder(e.target.value)}
              placeholder="/home/steam/arma3"
            />
            <p className={settings.hint}>Used by the Logs page when Remote is selected.</p>
          </label>

          <div className="flex min-w-0 flex-col">
            {remoteServers.length === 0 ? (
              <p className={settings.cardBody}>No remote servers saved yet.</p>
            ) : (
              remoteServers.map((row) => (
                <div key={row.id} className={settings.serverRow}>
                  <p className="m-0 text-sm text-heading">
                    <span className="font-semibold">{row.name}</span> — {row.username}@{row.host}:{row.port}
                  </p>
                  <p className={`${settings.hint} mt-1.5`}>
                    Auth: {row.auth === 'key' ? `Key file (${row.keyPath ?? 'path not set'})` : 'Username + password'}
                  </p>
                  <div className={`${settings.formActions} pt-1`}>
                    <button type="button" className="btn btn-ghost" onClick={() => onEdit(row)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => onRemove(row.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className={settings.formActions}>
            <button type="button" className="btn btn-primary" onClick={onAdd}>
              Add remote server
            </button>
          </div>
        </>
      )}
    </SettingsCard>
  )
}
