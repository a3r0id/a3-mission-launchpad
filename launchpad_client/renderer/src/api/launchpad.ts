import { getElectronIpc } from '../electronIpc'

export type ManagedScenario = {
  id: string
  name: string
  map_suffix: string
  description: string
  author: string
  mission_type: string
  generate_scripting_environment: boolean
  /** When true, mission project is treated as a Git repo for the GitHub panel (local commits / history). */
  github_integration?: boolean
  project_path?: string
  profile_path?: string
  launch_mods?: MissionLaunchMod[]
}

export type MissionLaunchMod = {
  id: string
  path: string
  enabled: boolean
  label?: string
}

export type ManagedModProject = {
  id: string
  name: string
  description: string
  project_path?: string
}

export type CreateManagedModProjectPayload = {
  name: string
  description?: string
}

export type UpdateManagedModProjectPayload = {
  name?: string
  description?: string
}

export type CreateManagedModProjectSuccess = {
  ok: true
  project: ManagedModProject
}

export type ManagedModProjectMutationError = {
  ok?: false
  error: string
}

export type UpdateManagedScenarioPayload = {
  name?: string
  map_suffix?: string
  github_integration?: boolean
}

export type GitStatusFile = { code: string; path: string }

export type MissionGitRoot = 'none' | 'parent' | 'mission'

export type GitStatusResponse = {
  ok: boolean
  error?: string
  /** Git at the mission folder itself (not a parent directory). */
  missionGitRoot?: MissionGitRoot
  missionProjectPath?: string
  detectedGitToplevel?: string | null
  hasMissionRepo?: boolean
  /** Alias for ``hasMissionRepo`` (mission-local repo). */
  hasGit?: boolean
  hasGhCli?: boolean
  ghAuthenticated?: boolean
  suggestedRepoName?: string
  defaultPublishVisibility?: 'public' | 'private'
  originUrl?: string | null
  message?: string
  branch?: string
  upstream?: string | null
  branchLine?: string
  files?: GitStatusFile[]
}

export type GitLogCommit = { hash: string; subject: string; author: string; date: string }

export type GitLogResponse = {
  ok: boolean
  error?: string
  commits: GitLogCommit[]
  skipped?: boolean
  missionGitRoot?: MissionGitRoot
}

export type GitCommitResponse = {
  ok: boolean
  error?: string
  summary?: string
}

export type GitInitResponse = {
  ok: boolean
  error?: string
  message?: string
  already?: boolean
}

export type GitPublishResponse = {
  ok: boolean
  error?: string
  summary?: string
  originUrl?: string | null
}

/** Default GitHub repo slug from mission name / map (matches server rules). */
export function suggestGithubRepoSlug(missionName: string, mapSuffix: string): string {
  const part = (x: string) => {
    const t = x.trim()
    let seg = t.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    seg = seg.replace(/-{2,}/g, '-').replace(/^\.+|\.+$/g, '')
    return seg
  }
  let a = part(missionName)
  let b = part(mapSuffix)
  if (!a) a = 'arma3-mission'
  if (!b) b = 'map'
  let slug = `${a}.${b}`
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(slug)) slug = 'arma3-mission'
  return slug.slice(0, 100)
}

export type ProjectTreeNode = {
  name: string
  kind: 'dir' | 'file'
  relPath: string
  size?: number | null
  truncated?: boolean
  children?: ProjectTreeNode[]
}

export type MissionProjectTreeResponse = {
  tree: ProjectTreeNode
  rootName: string
  truncated?: boolean
}

export type UpdateManagedScenarioSuccess = {
  ok: true
  mission: ManagedScenario
  symlink_message?: string
}

export type UpdateManagedScenarioError = {
  ok?: false
  error: string
}

export type MissionModsResponse = {
  ok: true
  mods: MissionLaunchMod[]
}

export type MissionLaunchResponse = {
  ok: true
  pid: number
  argv: string[]
  missionFolderName: string
  modsApplied: number
  message?: string
}

export type MissionBuildResponse = {
  status: number
  warnings: string[]
  messages: string[]
  mission_path?: string
  mission_id?: string
  error?: string
}

export type MissionBuildPayload = {
  mission_name: string
  map_suffix: string
  author: string
  network_type: 'Singleplayer' | 'Multiplayer'
  generate_scripting_environment: boolean
  game_type: string
}

export type LaunchpadSettings = {
  arma3_path: string
  arma3_workshop_path: string
  arma3_tools_path: string
  /** Arma 3 profile directory (…/Arma 3 - Other Profiles/<name>) — required for new mission builds. */
  arma3_profile_path: string
  /**
   * Arma 3 folder under Local AppData (default `%LOCALAPPDATA%\\Arma 3` on Windows).
   * Used for logs, BattlEye, some configs — not the same as the Documents profile folder.
   */
  arma3_appdata_path: string
  /** Prefills the Author field on New Mission when set. */
  default_author: string
  /** Default for ``gh repo create`` visibility when not overridden in the GitHub panel. */
  github_new_repo_visibility: 'public' | 'private'
  remote_servers: RemoteServerSettingsEntry[]
  logs_remote_default_server_id: string
  logs_remote_default_folder: string
}

export type RemoteServerAuthKind = 'password' | 'key'

export type RemoteServerSettingsEntry = {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth: RemoteServerAuthKind
  keyPath?: string
}

export type UpdateSettingsSuccess = LaunchpadSettings & { ok: true }

export type UpdateSettingsError = {
  ok?: false
  error: string
}

function parseRemoteServer(raw: unknown): RemoteServerSettingsEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const host = typeof row.host === 'string' ? row.host.trim() : ''
  const username = typeof row.username === 'string' ? row.username.trim() : ''
  if (!id || !host || !username) return null
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : host
  const authRaw = typeof row.auth === 'string' ? row.auth.trim().toLowerCase() : ''
  const auth: RemoteServerAuthKind = authRaw === 'key' ? 'key' : 'password'
  const portRaw = Number.isFinite(row.port) ? Number(row.port) : Number.NaN
  const port = Number.isInteger(portRaw) && portRaw > 0 ? portRaw : 22
  const keyPath = typeof row.keyPath === 'string' ? row.keyPath.trim() : ''
  return {
    id,
    name,
    host,
    port,
    username,
    auth,
    keyPath: auth === 'key' && keyPath ? keyPath : undefined,
  }
}

function parseLaunchpadSettings(raw: Record<string, unknown>): LaunchpadSettings {
  const gv = typeof raw.github_new_repo_visibility === 'string' ? raw.github_new_repo_visibility.trim().toLowerCase() : ''
  const githubVis: 'public' | 'private' = gv === 'public' ? 'public' : 'private'
  const remoteServersRaw = Array.isArray(raw.remote_servers) ? raw.remote_servers : []
  const remoteServers = remoteServersRaw
    .map((row) => parseRemoteServer(row))
    .filter((row): row is RemoteServerSettingsEntry => row !== null)
  return {
    arma3_path: typeof raw.arma3_path === 'string' ? raw.arma3_path : '',
    arma3_workshop_path:
      typeof raw.arma3_workshop_path === 'string'
        ? raw.arma3_workshop_path
        : typeof raw.arma3_path === 'string' && raw.arma3_path.trim()
          ? `${raw.arma3_path.replace(/[/\\]+$/, '')}/!Workshop`
          : '',
    arma3_tools_path: typeof raw.arma3_tools_path === 'string' ? raw.arma3_tools_path : '',
    arma3_profile_path: typeof raw.arma3_profile_path === 'string' ? raw.arma3_profile_path : '',
    arma3_appdata_path: typeof raw.arma3_appdata_path === 'string' ? raw.arma3_appdata_path : '',
    default_author: typeof raw.default_author === 'string' ? raw.default_author : '',
    github_new_repo_visibility: githubVis,
    remote_servers: remoteServers,
    logs_remote_default_server_id: typeof raw.logs_remote_default_server_id === 'string' ? raw.logs_remote_default_server_id : '',
    logs_remote_default_folder: typeof raw.logs_remote_default_folder === 'string' ? raw.logs_remote_default_folder : '/home/steam/arma3',
  }
}

function apiBase(): string {
  return ''
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}${p}`
}

export async function fetchMissionBuild(payload: MissionBuildPayload): Promise<MissionBuildResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('mission-build', payload)) as MissionBuildResponse
    return {
      status: typeof data?.status === 'number' ? data.status : 1,
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      messages: Array.isArray(data?.messages) ? data.messages : [],
      mission_path: typeof data?.mission_path === 'string' ? data.mission_path : undefined,
      mission_id: typeof data?.mission_id === 'string' ? data.mission_id : undefined,
      error: typeof data?.error === 'string' ? data.error : undefined,
    }
  }

  const res = await fetch(apiUrl('/api/mission/build'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = (await res.json()) as MissionBuildResponse & { error?: string }
  if (!res.ok) return { status: 1, warnings: [], messages: [], error: data.error ?? `Request failed (HTTP ${res.status})` }
  return data
}

export async function fetchManagedScenarios(): Promise<ManagedScenario[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-scenarios')) as unknown
    if (!Array.isArray(data)) throw new Error('Invalid managed scenarios response.')
    return data as ManagedScenario[]
  }

  const res = await fetch(apiUrl('/api/managed/scenarios'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return (await res.json()) as ManagedScenario[]
}

function managedGitBase(missionId: string): string {
  return `/api/managed/scenarios/${encodeURIComponent(missionId)}/git`
}

function managedScenarioBase(missionId: string): string {
  return `/api/managed/scenarios/${encodeURIComponent(missionId)}`
}

export async function fetchMissionGitStatus(missionId: string): Promise<GitStatusResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('mission-git-status', { id: missionId })) as GitStatusResponse
  }
  const res = await fetch(apiUrl(`${managedGitBase(missionId)}/status`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: GitStatusResponse
  try {
    data = (await res.json()) as GitStatusResponse
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(typeof err === 'string' ? err : `Request failed (HTTP ${res.status})`)
  }
  return data
}

export async function fetchMissionGitLog(missionId: string, limit = 30): Promise<GitLogResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('mission-git-log', { id: missionId, limit })) as GitLogResponse
  }
  const q = new URLSearchParams({ limit: String(limit) })
  const res = await fetch(apiUrl(`${managedGitBase(missionId)}/log?${q.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: GitLogResponse
  try {
    data = (await res.json()) as GitLogResponse
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(typeof err === 'string' ? err : `Request failed (HTTP ${res.status})`)
  }
  return data
}

export async function postMissionGitInit(missionId: string): Promise<GitInitResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('mission-git-init', { id: missionId })) as GitInitResponse
  }
  const res = await fetch(apiUrl(`${managedGitBase(missionId)}/init`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  let data: GitInitResponse
  try {
    data = (await res.json()) as GitInitResponse
  } catch {
    return { ok: false, error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const err = typeof data.error === 'string' ? data.error : `Request failed (HTTP ${res.status})`
    return { ok: false, error: err }
  }
  return data
}

export type GitPublishPayload = {
  repo_name: string
  visibility?: 'public' | 'private'
  description?: string
}

export async function postMissionGitPublish(
  missionId: string,
  payload: GitPublishPayload,
): Promise<GitPublishResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('mission-git-publish', { id: missionId, ...payload })) as GitPublishResponse
  }
  const res = await fetch(apiUrl(`${managedGitBase(missionId)}/publish`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo_name: payload.repo_name,
      visibility: payload.visibility,
      description: payload.description,
    }),
  })
  let data: GitPublishResponse
  try {
    data = (await res.json()) as GitPublishResponse
  } catch {
    return { ok: false, error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const err = typeof data.error === 'string' ? data.error : `Request failed (HTTP ${res.status})`
    return { ok: false, error: err }
  }
  return data
}

export async function postMissionGitCommit(missionId: string, message: string): Promise<GitCommitResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('mission-git-commit', { id: missionId, message })) as GitCommitResponse
  }
  const res = await fetch(apiUrl(`${managedGitBase(missionId)}/commit`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  })
  let data: GitCommitResponse
  try {
    data = (await res.json()) as GitCommitResponse
  } catch {
    return { ok: false, error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const err = typeof data.error === 'string' ? data.error : `Request failed (HTTP ${res.status})`
    return { ok: false, error: err }
  }
  return data
}

export async function fetchMissionProjectTree(projectRoot: string): Promise<MissionProjectTreeResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('mission-project-tree', projectRoot)) as
      | (MissionProjectTreeResponse & { error?: string })
      | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    if (!data.tree || typeof data.rootName !== 'string') throw new Error('Unexpected project tree response.')
    return data
  }

  const q = new URLSearchParams({ path: projectRoot })
  const res = await fetch(apiUrl(`/api/mission/project-tree?${q.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: MissionProjectTreeResponse & { error?: string }
  try {
    data = (await res.json()) as MissionProjectTreeResponse & { error?: string }
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (HTTP ${res.status})`)
  }
  return data
}

export async function fetchManagedScenarioMods(id: string): Promise<MissionLaunchMod[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-scenario-mods-get', { id })) as { ok?: boolean; mods?: unknown; error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error)
    return Array.isArray(data?.mods) ? (data.mods as MissionLaunchMod[]) : []
  }
  const res = await fetch(apiUrl(`${managedScenarioBase(id)}/mods`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: MissionModsResponse & { error?: string }
  try {
    data = (await res.json()) as MissionModsResponse & { error?: string }
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (HTTP ${res.status})`)
  }
  return Array.isArray(data.mods) ? data.mods : []
}

export async function saveManagedScenarioMods(
  id: string,
  mods: Omit<MissionLaunchMod, 'id'>[] | MissionLaunchMod[],
): Promise<MissionLaunchMod[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-scenario-mods-post', { id, mods })) as { ok?: boolean; mods?: unknown; error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error)
    return Array.isArray(data?.mods) ? (data.mods as MissionLaunchMod[]) : []
  }
  const res = await fetch(apiUrl(`${managedScenarioBase(id)}/mods`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mods }),
  })
  let data: MissionModsResponse & { error?: string }
  try {
    data = (await res.json()) as MissionModsResponse & { error?: string }
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (HTTP ${res.status})`)
  }
  return Array.isArray(data.mods) ? data.mods : []
}

export async function launchManagedScenario(
  id: string,
  extraArgs?: string | string[],
): Promise<MissionLaunchResponse | { ok?: false; error: string }> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-scenario-launch-post', { id, extra_args: extraArgs })) as MissionLaunchResponse & { error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) return { error: data.error }
    return data
  }
  const res = await fetch(apiUrl(`${managedScenarioBase(id)}/launch`), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ extra_args: extraArgs }),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    return { error: typeof err === 'string' ? err : `Request failed (HTTP ${res.status})` }
  }
  const row = data as MissionLaunchResponse & { ok?: boolean }
  if (row.ok !== true || typeof row.pid !== 'number' || !Array.isArray(row.argv)) {
    return { error: 'Unexpected launch response.' }
  }
  return row
}

export async function updateManagedScenario(
  id: string,
  payload: UpdateManagedScenarioPayload,
): Promise<UpdateManagedScenarioSuccess | UpdateManagedScenarioError> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('managed-scenario-update-patch', { id, patch: payload })) as
      | UpdateManagedScenarioSuccess
      | UpdateManagedScenarioError
  }
  const res = await fetch(apiUrl(`/api/managed/scenarios/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return {
      error: `Invalid response (HTTP ${res.status})`,
    }
  }
  if (!res.ok) {
    const body = data as { error?: string }
    return {
      error:
        typeof body.error === 'string'
          ? body.error
          : `Request failed (HTTP ${res.status})`,
    }
  }
  return data as UpdateManagedScenarioSuccess
}

export type DeleteManagedScenarioOptions = {
  /** When true, removes the project directory under launchpad_data/mission_projects (server-enforced). */
  deleteProjectFiles?: boolean
}

export async function deleteManagedScenario(
  id: string,
  options?: DeleteManagedScenarioOptions,
): Promise<void> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-scenario-delete', {
      id,
      delete_project_files: Boolean(options?.deleteProjectFiles),
    })) as { ok?: boolean; error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error)
    return
  }
  const payload =
    options?.deleteProjectFiles != null
      ? JSON.stringify({ delete_project_files: Boolean(options.deleteProjectFiles) })
      : undefined
  const res = await fetch(apiUrl(`/api/managed/scenarios/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload,
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
}

export async function fetchManagedModProjects(): Promise<ManagedModProject[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-mod-projects')) as unknown
    if (!Array.isArray(data)) throw new Error('Invalid mod projects response.')
    return data as ManagedModProject[]
  }
  const res = await fetch(apiUrl('/api/managed/mod-projects'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return (await res.json()) as ManagedModProject[]
}

export async function createManagedModProject(
  payload: CreateManagedModProjectPayload,
): Promise<CreateManagedModProjectSuccess | ManagedModProjectMutationError> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('managed-mod-project-create', payload)) as
      | CreateManagedModProjectSuccess
      | ManagedModProjectMutationError
  }
  const res = await fetch(apiUrl('/api/managed/mod-projects'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const body = data as { error?: string }
    return {
      error:
        typeof body.error === 'string'
          ? body.error
          : `Request failed (HTTP ${res.status})`,
    }
  }
  return data as CreateManagedModProjectSuccess
}

export type UpdateManagedModProjectSuccess = {
  ok: true
  project: ManagedModProject
}

export async function updateManagedModProject(
  id: string,
  payload: UpdateManagedModProjectPayload,
): Promise<UpdateManagedModProjectSuccess | ManagedModProjectMutationError> {
  const ipc = getElectronIpc()
  if (ipc) {
    return (await ipc.invoke('managed-mod-project-update-patch', { id, patch: payload })) as
      | UpdateManagedModProjectSuccess
      | ManagedModProjectMutationError
  }
  const res = await fetch(apiUrl(`/api/managed/mod-projects/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const body = data as { error?: string }
    return {
      error:
        typeof body.error === 'string'
          ? body.error
          : `Request failed (HTTP ${res.status})`,
    }
  }
  return data as UpdateManagedModProjectSuccess
}

export type DeleteManagedModProjectOptions = {
  deleteProjectFiles?: boolean
}

export async function deleteManagedModProject(
  id: string,
  options?: DeleteManagedModProjectOptions,
): Promise<void> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('managed-mod-project-delete', {
      id,
      delete_project_files: Boolean(options?.deleteProjectFiles),
    })) as { ok?: boolean; error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error)
    return
  }
  const payload =
    options?.deleteProjectFiles != null
      ? JSON.stringify({ delete_project_files: Boolean(options.deleteProjectFiles) })
      : undefined
  const res = await fetch(apiUrl(`/api/managed/mod-projects/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload,
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
}

export async function fetchSettings(): Promise<LaunchpadSettings> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('get-settings')) as { settings?: Record<string, unknown>; error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error)
    const raw = data?.settings ?? {}
    return parseLaunchpadSettings(raw)
  }
  const res = await fetch(apiUrl('/api/settings'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const raw = (await res.json()) as Record<string, unknown>
  return parseLaunchpadSettings(raw)
}

export async function updateSettings(
  patch: Partial<
    Pick<
      LaunchpadSettings,
      | 'arma3_path'
      | 'arma3_workshop_path'
      | 'arma3_tools_path'
      | 'arma3_profile_path'
      | 'arma3_appdata_path'
      | 'default_author'
      | 'github_new_repo_visibility'
      | 'remote_servers'
      | 'logs_remote_default_server_id'
      | 'logs_remote_default_folder'
    >
  >,
): Promise<UpdateSettingsSuccess | UpdateSettingsError> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('set-settings', { settings: patch })) as { error?: string }
    if (typeof data?.error === 'string' && data.error.trim()) return { error: data.error }
    const fresh = await fetchSettings()
    return { ok: true, ...fresh }
  }
  const res = await fetch(apiUrl('/api/settings'), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return {
      error: `Invalid response (HTTP ${res.status})`,
    }
  }
  if (!res.ok) {
    const body = data as { error?: string }
    return {
      error:
        typeof body.error === 'string'
          ? body.error
          : `Request failed (HTTP ${res.status})`,
    }
  }
  const row = data as Record<string, unknown>
  if (row.ok !== true) {
    return data as UpdateSettingsError
  }
  return { ok: true, ...parseLaunchpadSettings(row) }
}

export type TestingModEntry = {
  id: string
  path: string
  enabled: boolean
  label?: string
}

export type TestingModlistResponse = {
  ok: true
  mods: TestingModEntry[]
}

/** High-level autotest options; the backend writes JSON and passes ``-autotest=<absolute path>``. */
export type AutotestSpec = {
  label?: string
  iterations?: number
  max_duration_sec?: number
  tags?: string[]
}

export type TestingLaunchPayload = {
  managed_scenario_id: string
  /** Shell-style string (split with POSIX rules) or array of argv tokens. */
  extra_args?: string | string[]
  /** When true, appends the companion extension mod folder into launch `-mod=`. */
  use_companion_extension?: boolean
  /** When true, enables autotest (see ``autotest_spec``). */
  autotest?: boolean
  /**
   * When ``autotest`` is true, sent as a JSON object (use ``{}`` for metadata-only file).
   * The server merges mission id / folder name / timestamp and writes ``testing_autotest_temp/autotest_*.json``.
   */
  autotest_spec?: AutotestSpec
  /**
   * Legacy: raw ``-autotest=`` value. Ignored if ``autotest_spec`` is present.
   * Prefer ``autotest_spec`` so the game receives a generated file path.
   */
  autotest_config?: string
}

export type TestingLaunchSuccess = {
  ok: true
  pid: number
  argv: string[]
  missionFolderName: string
  autotestWatchId?: string
  /** Present when the server used a generated autotest JSON file. */
  autotestFilePath?: string
  message?: string
}

export type TestingAutotestDetectedResult = {
  result: string
  end_mode: string
  mission: string
  detected_ts: number
  rpt_path: string
  raw_block: string
  fields: Record<string, string>
}

export type TestingAutotestResultPollResponse = {
  ok: true
  active: boolean
  complete: boolean
  reason?: string
  watch_id?: string
  started_ts?: number
  poll_count?: number
  result_data?: TestingAutotestDetectedResult
}

export async function fetchTestingModlist(): Promise<TestingModEntry[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('testing-modlist-get')) as { mods?: unknown; error?: string } | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    return Array.isArray(data.mods) ? (data.mods as TestingModEntry[]) : []
  }

  const res = await fetch(apiUrl('/api/testing/modlist'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const data = (await res.json()) as TestingModlistResponse
  if (!Array.isArray(data.mods)) return []
  return data.mods
}

export async function saveTestingModlist(mods: Omit<TestingModEntry, 'id'>[] | TestingModEntry[]): Promise<TestingModEntry[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('testing-modlist-post', { mods })) as { mods?: unknown; error?: string } | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    return Array.isArray(data.mods) ? (data.mods as TestingModEntry[]) : []
  }

  const res = await fetch(apiUrl('/api/testing/modlist'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mods }),
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const data = (await res.json()) as TestingModlistResponse
  return Array.isArray(data.mods) ? data.mods : []
}

export async function patchTestingModlistEnabled(
  updates: { id: string; enabled: boolean }[],
): Promise<TestingModEntry[]> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('testing-modlist-patch', { updates })) as
      | { mods?: unknown; error?: string }
      | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    return Array.isArray(data.mods) ? (data.mods as TestingModEntry[]) : []
  }

  const res = await fetch(apiUrl('/api/testing/modlist'), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ updates }),
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const data = (await res.json()) as TestingModlistResponse
  return Array.isArray(data.mods) ? data.mods : []
}

export async function postTestingLaunch(
  payload: TestingLaunchPayload,
): Promise<TestingLaunchSuccess | { ok?: false; error: string }> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('testing-launch', {
      managed_scenario_id: payload.managed_scenario_id,
      extra_args: payload.extra_args,
      use_companion_extension: payload.use_companion_extension === true,
      autotest: payload.autotest === true,
      ...(payload.autotest === true && payload.autotest_spec !== undefined
        ? { autotest_spec: payload.autotest_spec }
        : {}),
      ...(payload.autotest_config !== undefined ? { autotest_config: payload.autotest_config } : {}),
    })) as (TestingLaunchSuccess & { ok?: boolean; error?: string }) | null
    if (!data || typeof data !== 'object') {
      return { error: 'Invalid response from desktop API.' }
    }
    if (typeof data.error === 'string' && data.error.trim()) {
      return { error: data.error }
    }
    if (data.ok !== true || typeof data.pid !== 'number' || !Array.isArray(data.argv)) {
      return { error: 'Unexpected launch response.' }
    }
    return data as TestingLaunchSuccess
  }

  const res = await fetch(apiUrl('/api/testing/launch'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      managed_scenario_id: payload.managed_scenario_id,
      extra_args: payload.extra_args,
      use_companion_extension: payload.use_companion_extension === true,
      autotest: payload.autotest === true,
      ...(payload.autotest === true && payload.autotest_spec !== undefined
        ? { autotest_spec: payload.autotest_spec }
        : {}),
      ...(payload.autotest_config !== undefined ? { autotest_config: payload.autotest_config } : {}),
    }),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return { error: `Invalid response (HTTP ${res.status})` }
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    return { error: typeof err === 'string' ? err : `Request failed (HTTP ${res.status})` }
  }
  const row = data as TestingLaunchSuccess & { ok?: boolean }
  if (row.ok !== true || typeof row.pid !== 'number' || !Array.isArray(row.argv)) {
    return { error: 'Unexpected launch response.' }
  }
  return row as TestingLaunchSuccess
}

export async function fetchTestingAutotestResult(
  watchId: string,
): Promise<TestingAutotestResultPollResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('testing-autotest-result-get', {
      watch_id: watchId.trim(),
    })) as (TestingAutotestResultPollResponse & { error?: string }) | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    if (data.ok !== true || typeof data.active !== 'boolean' || typeof data.complete !== 'boolean') {
      throw new Error('Unexpected autotest poll response.')
    }
    return data
  }

  const q = new URLSearchParams()
  if (watchId.trim()) q.set('watch_id', watchId.trim())
  const res = await fetch(apiUrl(`/api/testing/autotest-result?${q.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(typeof err === 'string' ? err : `Request failed (HTTP ${res.status})`)
  }
  const row = data as TestingAutotestResultPollResponse
  if (row.ok !== true || typeof row.active !== 'boolean' || typeof row.complete !== 'boolean') {
    throw new Error('Unexpected autotest poll response.')
  }
  return row
}

export type ArmaProcessSnapshotRow = {
  pid: number
  name: string
  exe: string | null
  cmdline: string[] | null
  username: string | null
  create_time: number | null
  cpu_percent: number
  memory_rss: number
  memory_vms: number
  memory_percent: number
  num_threads: number
  num_handles: number | null
  io_read_bytes: number | null
  io_write_bytes: number | null
  children: number[]
}

export type ArmaProcessSnapshot = {
  ok: true
  processes: ArmaProcessSnapshotRow[]
  sampled_at_ms: number
}

export type RptFileEntry = {
  name: string
  path: string
  size: number
  modified_ts: number
}

export type RptLogListLocation = 'profile' | 'tools' | 'remote'

export type RptFileListResponse = {
  ok: true
  folder: string
  rpt_files: RptFileEntry[]
  location?: RptLogListLocation
}

export type PartialFileContentsResponse = {
  ok: true
  path: string
  content: string
  start: number
  end: number
  file_size: number
}

export type RemoteSshConnectionPayload = {
  host: string
  port: number
  username: string
  auth: 'password' | 'key'
  keyPath?: string
  password?: string
  passphrase?: string
}

export type RemoteSshSessionOpenResponse = {
  ok: true
  session_id: string
  sessionId?: string
  host: string
  port: number
  username: string
}

export async function openRemoteSshSession(
  payload: RemoteSshConnectionPayload,
): Promise<RemoteSshSessionOpenResponse> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Remote log connections require the Launchpad desktop app.')
  const data = (await ipc.invoke('ssh-session-open', payload)) as
    | (RemoteSshSessionOpenResponse & { error?: string })
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (data.ok !== true) throw new Error(data.error ?? 'Could not open SSH session.')
  if (typeof data.session_id !== 'string' || !data.session_id.trim()) {
    throw new Error('SSH session did not return a session id.')
  }
  return data
}

export async function closeRemoteSshSession(sessionId: string): Promise<void> {
  const ipc = getElectronIpc()
  if (!ipc) return
  const data = (await ipc.invoke('ssh-session-close', { session_id: sessionId })) as
    | { ok?: boolean; error?: string }
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (data.ok !== true) throw new Error(data.error ?? 'Could not close SSH session.')
}

export async function fetchRemoteRptFiles(sessionId: string, folder: string): Promise<RptFileListResponse> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Remote log listing requires the Launchpad desktop app.')
  const data = (await ipc.invoke('ssh-rpt-list', { session_id: sessionId, folder })) as
    | (RptFileListResponse & { error?: string })
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
  if (data.ok !== true || !Array.isArray(data.rpt_files)) {
    throw new Error('Unexpected remote RPT file list response.')
  }
  return data
}

export async function fetchRemotePartialFileContents(
  sessionId: string,
  path: string,
  start = 0,
  mode: 'init' | 'next' = 'next',
): Promise<PartialFileContentsResponse> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Remote log tailing requires the Launchpad desktop app.')
  const channel = mode === 'init' ? 'ssh-rpt-tail-init' : 'ssh-rpt-tail-next'
  const data = (await ipc.invoke(channel, { session_id: sessionId, path, start })) as
    | (PartialFileContentsResponse & { error?: string })
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
  if (data.ok !== true || typeof data.content !== 'string') {
    throw new Error('Unexpected remote tail response.')
  }
  return data
}

export type DebugCommandType =
  | 'ping'
  | 'sqf.run'
  | 'sqf.eval'
  | 'mission.event'
  | 'extension.call'
  | 'custom'

export type DebugCommand = {
  id?: string
  ts?: number
  type: DebugCommandType | string
  payload?: Record<string, unknown>
}

export type DebugServerState = {
  host: string
  port: number
  listening: boolean
  connected: boolean
  clientAddress: string | null
  messagesSent: number
  messagesReceived: number
  lastError: string | null
}

export type DebugEvent = {
  id: string
  ts: number
  direction: 'inbound' | 'outbound' | 'system'
  type: string
  payload?: unknown
  raw?: unknown
  level?: 'info' | 'warn' | 'error'
}

export async function fetchDebugServerStatus(): Promise<DebugServerState> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Debug server requires the desktop app.')
  const data = (await ipc.invoke('debug-server-status')) as { ok?: boolean; state?: DebugServerState; error?: string }
  if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error)
  if (!data?.state) throw new Error('Debug server status is unavailable.')
  return data.state
}

export async function postDebugServerStart(host?: string, port?: number): Promise<DebugServerState> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Debug server requires the desktop app.')
  const data = (await ipc.invoke('debug-server-start', { host, port })) as
    | { ok?: boolean; state?: DebugServerState; error?: string }
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (data.ok !== true) throw new Error(data.error ?? 'Could not start debug server.')
  if (!data.state) throw new Error('Debug server did not return status.')
  return data.state
}

export async function postDebugServerStop(): Promise<DebugServerState> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Debug server requires the desktop app.')
  const data = (await ipc.invoke('debug-server-stop')) as
    | { ok?: boolean; state?: DebugServerState; error?: string }
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (data.ok !== true) throw new Error(data.error ?? 'Could not stop debug server.')
  if (!data.state) throw new Error('Debug server did not return status.')
  return data.state
}

export async function postDebugCommandSend(command: DebugCommand): Promise<DebugServerState> {
  const ipc = getElectronIpc()
  if (!ipc) throw new Error('Debug server requires the desktop app.')
  const data = (await ipc.invoke('debug-command-send', { command })) as
    | { ok?: boolean; state?: DebugServerState; error?: string }
    | null
  if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
  if (data.ok !== true) throw new Error(data.error ?? 'Could not send debug command.')
  if (!data.state) throw new Error('Debug server did not return status.')
  return data.state
}

export async function fetchArmaProcessSnapshot(): Promise<ArmaProcessSnapshot> {
  const ipc = getElectronIpc()
  if (ipc) {
    const raw = (await ipc.invoke('process-manager-get')) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof raw.error === 'string' && raw.error.trim()) throw new Error(raw.error)
    if (raw.ok !== true || !Array.isArray(raw.processes)) {
      throw new Error('Unexpected process snapshot response.')
    }
    return raw as ArmaProcessSnapshot
  }

  const res = await fetch(apiUrl('/api/process-manager'), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (typeof errBody.error === 'string') detail = errBody.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const raw = (await res.json()) as Record<string, unknown>
  if (raw.ok !== true || !Array.isArray(raw.processes)) {
    throw new Error('Unexpected process snapshot response.')
  }
  return raw as ArmaProcessSnapshot
}

export async function killArmaProcess(pid: number): Promise<void> {
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('process-manager-kill-post', { pid })) as { ok?: boolean; stopped?: boolean; error?: string } | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    if (data.ok !== true || data.stopped !== true) {
      throw new Error('Unexpected stop-session response.')
    }
    return
  }

  const res = await fetch(apiUrl('/api/process-manager/kill'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pid }),
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(typeof err === 'string' ? err : `Request failed (HTTP ${res.status})`)
  }
  const row = data as { ok?: boolean; stopped?: boolean }
  if (row.ok !== true || row.stopped !== true) {
    throw new Error('Unexpected stop-session response.')
  }
}

export async function fetchRptFiles(location: RptLogListLocation = 'profile'): Promise<RptFileListResponse> {
  if (location === 'remote') {
    throw new Error('Use fetchRemoteRptFiles for remote log sources.')
  }
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('list-rpt-files', { location })) as
      | (RptFileListResponse & { error?: string })
      | null
    if (!data || typeof data !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof data.error === 'string' && data.error.trim()) throw new Error(data.error)
    if (data.ok !== true || !Array.isArray(data.rpt_files)) {
      throw new Error('Unexpected RPT file list response.')
    }
    return data
  }

  const qs = location === 'tools' ? '?location=tools' : ''
  const res = await fetch(apiUrl(`/api/list-rpt-files${qs}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(typeof err === 'string' ? err : `Request failed (HTTP ${res.status})`)
  }
  const row = data as RptFileListResponse
  if (row.ok !== true || !Array.isArray(row.rpt_files)) {
    throw new Error('Unexpected RPT file list response.')
  }
  return row
}

export async function fetchPartialFileContents(
  path: string,
  start = 0,
  end?: number,
): Promise<PartialFileContentsResponse> {
  const ipc = getElectronIpc()
  if (ipc) {
    const raw = (await ipc.invoke('get-file-contents-partial', { path, start, end })) as
      | (PartialFileContentsResponse & { error?: string })
      | null
    if (!raw || typeof raw !== 'object') throw new Error('Invalid response from desktop API.')
    if (typeof raw.error === 'string' && raw.error.trim()) throw new Error(raw.error)
    return {
      ok: true,
      path,
      content: typeof raw.content === 'string' ? raw.content : '',
      start: typeof raw.start === 'number' ? raw.start : 0,
      end: typeof raw.end === 'number' ? raw.end : 0,
      file_size: typeof raw.file_size === 'number' ? raw.file_size : 0,
    }
  }
  const q = new URLSearchParams({
    path,
    start: String(Math.max(0, Math.floor(start))),
  })
  if (typeof end === 'number' && Number.isFinite(end)) {
    q.set('end', String(Math.max(0, Math.floor(end))))
  }
  const res = await fetch(apiUrl(`/api/partial-file-contents?${q.toString()}`), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const err = (data as { error?: string }).error
    throw new Error(typeof err === 'string' ? err : `Request failed (HTTP ${res.status})`)
  }
  const row = data as PartialFileContentsResponse
  if (row.ok !== true || typeof row.content !== 'string') {
    throw new Error('Unexpected partial file response.')
  }
  return row
}

export type DecodePaaFromPathResult =
  | { ok: true; width: number; height: number; data: Uint8Array }
  | { ok: false; error: string }

function coerceBinaryPayload(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (data && typeof data === 'object' && ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  }
  return null
}

/** Decode a ``.paa`` on disk to RGBA8888 (desktop shell only). */
export async function decodePaaFromPath(absPath: string): Promise<DecodePaaFromPathResult> {
  const ipc = getElectronIpc()
  if (!ipc) {
    return { ok: false, error: 'Texture preview is only available in the desktop app.' }
  }
  const raw = (await ipc.invoke('decode-paa', { path: absPath })) as {
    ok?: boolean
    error?: string
    width?: number
    height?: number
    data?: unknown
  } | null
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid response from desktop API.' }
  }
  if (raw.ok !== true) {
    const err =
      typeof raw.error === 'string' && raw.error.trim() ? raw.error.trim() : 'Could not decode texture.'
    return { ok: false, error: err }
  }
  const w = raw.width
  const h = raw.height
  if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    return { ok: false, error: 'Could not decode texture.' }
  }
  const u8 = coerceBinaryPayload(raw.data)
  const expected = Math.floor(w) * Math.floor(h) * 4
  if (!u8 || u8.byteLength !== expected) {
    return { ok: false, error: 'Could not decode texture.' }
  }
  return { ok: true, width: Math.floor(w), height: Math.floor(h), data: u8 }
}

export type GetP3dPreviewMeshFromPathResult =
  | {
      ok: true
      lodIndex: number
      vertexCount: number
      triangleCount: number
      positions: Float32Array
      indices: Uint32Array
      normals: Float32Array
      uvs: Float32Array | null
      primaryTexture: string | null
      textureNames: string[]
    }
  | { ok: false; error: string }

/** Load a ``.p3d`` mesh for the model preview (desktop shell only). */
export async function getP3dPreviewMeshFromPath(absPath: string): Promise<GetP3dPreviewMeshFromPathResult> {
  const ipc = getElectronIpc()
  if (!ipc) {
    return { ok: false, error: 'Model preview is only available in the desktop app.' }
  }
  const raw = (await ipc.invoke('get-p3d-preview-mesh', { path: absPath })) as {
    ok?: boolean
    error?: string
    lodIndex?: number
    vertexCount?: number
    triangleCount?: number
    positions?: unknown
    indices?: unknown
    normals?: unknown
    uvs?: unknown
    primaryTexture?: unknown
    textureNames?: unknown
  } | null
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid response from desktop API.' }
  }
  if (raw.ok !== true) {
    const err =
      typeof raw.error === 'string' && raw.error.trim() ? raw.error.trim() : 'This model could not be previewed.'
    return { ok: false, error: err }
  }
  const vc = raw.vertexCount
  const tc = raw.triangleCount
  const li = raw.lodIndex
  if (
    typeof vc !== 'number' ||
    typeof tc !== 'number' ||
    typeof li !== 'number' ||
    !Number.isFinite(vc) ||
    !Number.isFinite(tc) ||
    !Number.isFinite(li) ||
    vc < 1 ||
    tc < 1
  ) {
    return { ok: false, error: 'This model could not be previewed.' }
  }
  const posBuf = coerceBinaryPayload(raw.positions)
  const idxBuf = coerceBinaryPayload(raw.indices)
  const nrmBuf = coerceBinaryPayload(raw.normals)
  const vCount = Math.floor(vc)
  const tCount = Math.floor(tc)
  const posNeed = vCount * 12
  const idxNeed = tCount * 12
  const nrmNeed = vCount * 12
  if (!posBuf || posBuf.byteLength !== posNeed || !idxBuf || idxBuf.byteLength !== idxNeed || !nrmBuf || nrmBuf.byteLength !== nrmNeed) {
    return { ok: false, error: 'This model could not be previewed.' }
  }
  const uvBuf = coerceBinaryPayload(raw.uvs)
  const uvNeed = vCount * 8
  const uvs =
    uvBuf && uvBuf.byteLength === uvNeed ? new Float32Array(uvBuf.buffer, uvBuf.byteOffset, vCount * 2) : null

  let textureNames: string[] = []
  if (Array.isArray(raw.textureNames)) {
    textureNames = raw.textureNames.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  }
  const pt =
    typeof raw.primaryTexture === 'string' && raw.primaryTexture.trim() ? raw.primaryTexture.trim() : null
  const primaryTexture = pt ?? textureNames[0] ?? null

  return {
    ok: true,
    lodIndex: Math.floor(li),
    vertexCount: vCount,
    triangleCount: tCount,
    positions: new Float32Array(posBuf.buffer, posBuf.byteOffset, vCount * 3),
    indices: new Uint32Array(idxBuf.buffer, idxBuf.byteOffset, tCount * 3),
    normals: new Float32Array(nrmBuf.buffer, nrmBuf.byteOffset, vCount * 3),
    uvs,
    primaryTexture,
    textureNames,
  }
}

export async function checkBackendReachable(): Promise<boolean> {
  return getElectronIpc() !== null
}
