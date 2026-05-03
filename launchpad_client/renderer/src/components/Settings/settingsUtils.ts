import type { LaunchpadSettings, RemoteServerSettingsEntry } from '../../api/launchpad'

export type CheckUpdatesOk = {
  ok: true
  current: string
  latest: string
  updateAvailable: boolean
  releasesUrl: string
  releaseTag: string
  canAutoInstall: boolean
}

export type CheckUpdatesResult = CheckUpdatesOk | { ok: false; message?: string }

export function trimField(v: string | undefined | null): string {
  return (v ?? '').trim()
}

export const EMPTY_SETTINGS_BASELINE: LaunchpadSettings = {
  arma3_path: '',
  arma3_workshop_path: '',
  arma3_tools_path: '',
  arma3_profile_path: '',
  arma3_appdata_path: '',
  default_author: '',
  github_new_repo_visibility: 'private',
  remote_servers: [],
  logs_remote_default_server_id: '',
  logs_remote_default_folder: '/home/steam/arma3',
  hemtt_path: '',
}

export function sameSettings(a: LaunchpadSettings, b: LaunchpadSettings) {
  const normServers = (rows: RemoteServerSettingsEntry[]) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      auth: r.auth,
      keyPath: r.keyPath ?? '',
    }))
  return (
    a.arma3_path === b.arma3_path &&
    a.arma3_workshop_path === b.arma3_workshop_path &&
    a.arma3_tools_path === b.arma3_tools_path &&
    a.arma3_profile_path === b.arma3_profile_path &&
    a.arma3_appdata_path === b.arma3_appdata_path &&
    a.default_author === b.default_author &&
    a.github_new_repo_visibility === b.github_new_repo_visibility &&
    a.logs_remote_default_server_id === b.logs_remote_default_server_id &&
    a.logs_remote_default_folder === b.logs_remote_default_folder &&
    a.hemtt_path === b.hemtt_path &&
    JSON.stringify(normServers(a.remote_servers)) === JSON.stringify(normServers(b.remote_servers))
  )
}

export function newRemoteServerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `srv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}
