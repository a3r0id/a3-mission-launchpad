export type ManagedScenario = {
  id: string
  name: string
  map_suffix: string
  description: string
  author: string
  mission_type: string
  generate_scripting_environment: boolean
  ext_params: unknown
  project_path?: string
  profile_path?: string
}

export type UpdateManagedScenarioPayload = {
  name?: string
  map_suffix?: string
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
  return (await res.json()) as LaunchpadSettings
}

export async function updateSettings(
  patch: Partial<
    Pick<LaunchpadSettings, 'arma3_path' | 'arma3_tools_path' | 'arma3_profile_path'>
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
  return data as UpdateSettingsSuccess
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
