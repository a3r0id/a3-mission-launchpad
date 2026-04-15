export type ManagedScenario = {
  id: string
  name: string
  map_suffix: string
  description: string
  author: string
  mission_type: string
  generate_scripting_environment: boolean
  ext_params: unknown
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

/** Game type from Description.ext header (`ext_params.header.gameType` on the API row). */
export function gameTypeFromExtParams(ext: unknown): string {
  if (!ext || typeof ext !== 'object') return ''
  const header = (ext as { header?: unknown }).header
  if (!header || typeof header !== 'object') return ''
  const gt = (header as { gameType?: unknown }).gameType
  return typeof gt === 'string' ? gt.trim() : ''
}

export type UpdateManagedScenarioPayload = {
  name?: string
  map_suffix?: string
  ext_params?: unknown
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

export type LaunchpadSettings = {
  arma3_path: string
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
}

export type UpdateSettingsSuccess = LaunchpadSettings & { ok: true }

export type UpdateSettingsError = {
  ok?: false
  error: string
}

/** When the UI is opened as file://, requests must target the Python server explicitly. */
function apiBase(): string {
  if (typeof window === 'undefined') return ''
  if (window.location.protocol !== 'file:') return ''
  return import.meta.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:8111'
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${apiBase()}${p}`
}

export async function fetchMissionBuild(
  init?: RequestInit,
): Promise<MissionBuildResponse> {
  const res = await fetch(apiUrl('/api/mission/build'), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  let data: MissionBuildResponse & { error?: string }
  try {
    data = (await res.json()) as MissionBuildResponse & { error?: string }
  } catch {
    return {
      status: 1,
      warnings: [],
      messages: [],
      error: `Invalid response (HTTP ${res.status})`,
    }
  }
  if (!res.ok) {
    return {
      status: 1,
      warnings: [],
      messages: [],
      error:
        typeof data.error === 'string'
          ? data.error
          : `Request failed (HTTP ${res.status})`,
    }
  }
  return data
}

export async function fetchManagedScenarios(): Promise<ManagedScenario[]> {
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

export async function fetchSettings(): Promise<LaunchpadSettings> {
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
  const gv = typeof raw.github_new_repo_visibility === 'string' ? raw.github_new_repo_visibility.trim().toLowerCase() : ''
  const githubVis: 'public' | 'private' = gv === 'public' ? 'public' : 'private'
  return {
    arma3_path: typeof raw.arma3_path === 'string' ? raw.arma3_path : '',
    arma3_tools_path: typeof raw.arma3_tools_path === 'string' ? raw.arma3_tools_path : '',
    arma3_profile_path: typeof raw.arma3_profile_path === 'string' ? raw.arma3_profile_path : '',
    arma3_appdata_path: typeof raw.arma3_appdata_path === 'string' ? raw.arma3_appdata_path : '',
    default_author: typeof raw.default_author === 'string' ? raw.default_author : '',
    github_new_repo_visibility: githubVis,
  }
}

export async function updateSettings(
  patch: Partial<
    Pick<
      LaunchpadSettings,
      | 'arma3_path'
      | 'arma3_tools_path'
      | 'arma3_profile_path'
      | 'arma3_appdata_path'
      | 'default_author'
      | 'github_new_repo_visibility'
    >
  >,
): Promise<UpdateSettingsSuccess | UpdateSettingsError> {
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
  const gv =
    typeof row.github_new_repo_visibility === 'string' ? row.github_new_repo_visibility.trim().toLowerCase() : ''
  const githubVis: 'public' | 'private' = gv === 'public' ? 'public' : 'private'
  return {
    ok: true,
    arma3_path: typeof row.arma3_path === 'string' ? row.arma3_path : '',
    arma3_tools_path: typeof row.arma3_tools_path === 'string' ? row.arma3_tools_path : '',
    arma3_profile_path: typeof row.arma3_profile_path === 'string' ? row.arma3_profile_path : '',
    arma3_appdata_path: typeof row.arma3_appdata_path === 'string' ? row.arma3_appdata_path : '',
    default_author: typeof row.default_author === 'string' ? row.default_author : '',
    github_new_repo_visibility: githubVis,
  }
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
  const res = await fetch(apiUrl('/api/testing/launch'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      managed_scenario_id: payload.managed_scenario_id,
      extra_args: payload.extra_args,
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

export type RptLogListLocation = 'profile' | 'tools'

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

export async function fetchArmaProcessSnapshot(): Promise<ArmaProcessSnapshot> {
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

export async function checkBackendReachable(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/mission/build'), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    return res.ok
  } catch {
    return false
  }
}
