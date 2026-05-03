import { FileFolderInput } from '../FileFolderInput'
import type { RemoteServerAuthKind } from '../../api/launchpad'
import { settings } from './settingsClasses'

type Props = {
  open: boolean
  mode: 'new' | 'edit'
  name: string
  host: string
  port: string
  username: string
  auth: RemoteServerAuthKind
  keyPath: string
  error: string | null
  onClose: () => void
  onSubmit: () => void
  onName: (v: string) => void
  onHost: (v: string) => void
  onPort: (v: string) => void
  onUser: (v: string) => void
  onAuth: (v: RemoteServerAuthKind) => void
  onKeyPath: (v: string) => void
}

export function RemoteServerDialog({
  open,
  mode,
  name,
  host,
  port,
  username,
  auth,
  keyPath,
  error,
  onClose,
  onSubmit,
  onName,
  onHost,
  onPort,
  onUser,
  onAuth,
  onKeyPath,
}: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remote-server-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px] dark:bg-black/60"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className="relative z-[1] flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl dark:border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-subtle/90 px-4 py-3 sm:px-5 dark:border-white/10">
          <div className="min-w-0 border-l-[3px] border-l-accent pl-3">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Remote servers
            </p>
            <h2
              id="remote-server-dialog-title"
              className="m-0 text-base font-semibold text-heading sm:text-lg"
            >
              {mode === 'edit' ? 'Edit remote server' : 'Add remote server'}
            </h2>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-lg leading-none text-muted hover:border-border hover:bg-app hover:text-heading"
            onClick={onClose}
            aria-label="Close"
          >
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <label className={settings.field}>
              <span className={settings.label}>Name</span>
              <input
                type="text"
                className={settings.input}
                value={name}
                onChange={(e) => onName(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className={settings.field}>
              <span className={settings.label}>Host</span>
              <input
                type="text"
                className={settings.input}
                value={host}
                onChange={(e) => onHost(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className={settings.field}>
              <span className={settings.label}>Port</span>
              <input
                type="number"
                className={settings.input}
                min={1}
                value={port}
                onChange={(e) => onPort(e.target.value)}
              />
            </label>
            <label className={settings.field}>
              <span className={settings.label}>Username</span>
              <input
                type="text"
                className={settings.input}
                value={username}
                onChange={(e) => onUser(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className={settings.field}>
              <span className={settings.label}>Authentication</span>
              <div className="relative">
                <select
                  className={settings.select}
                  value={auth}
                  onChange={(e) => onAuth(e.target.value === 'key' ? 'key' : 'password')}
                >
                  <option value="password">Username + password</option>
                  <option value="key">Username + key file</option>
                </select>
                <span
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted"
                  aria-hidden
                >
                  ▼
                </span>
              </div>
            </label>
            {auth === 'key' ? (
              <label className={settings.field}>
                <span className={settings.label}>Private key file path</span>
                <FileFolderInput
                  type="file"
                  commit="always"
                  autoComplete="off"
                  placeholder="e.g. C:\\Users\\You\\.ssh\\id_rsa"
                  inputClassName={settings.input}
                  value={keyPath}
                  onChange={onKeyPath}
                />
              </label>
            ) : null}
            {error ? (
              <p className={settings.bannerError} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <footer className="shrink-0 border-t border-border bg-subtle/80 px-4 py-3 sm:px-5 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="btn btn-primary" onClick={onSubmit}>
              Save server
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
