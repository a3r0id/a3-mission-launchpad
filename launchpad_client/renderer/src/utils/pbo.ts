import { apiUrl } from '../api/launchpad'
import { getElectronIpc } from '../electronIpc'
import { jsonHeaders } from './jsonHeaders'

export type BuildPboStreamEvent =
  | { type: 'log'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; pboPath: string }

export type BuildPboResult = {
  ok: boolean
  pboPath?: string
  log?: string[]
  error?: string
  code?: string
}

export class PboOutputExistsError extends Error {
  readonly code = 'pbo_exists' as const
  readonly pboPath: string

  constructor(pboPath: string, message?: string) {
    super(message ?? `A PBO file already exists at the output path: ${pboPath}`)
    this.name = 'PboOutputExistsError'
    this.pboPath = pboPath
  }
}

function buildPboPayload(
  projectPath: string,
  outputPath?: string,
  missionIdentity?: { missionName: string; mapSuffix: string },
  options?: { overwrite?: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    project_path: projectPath,
    output_path: outputPath?.trim() ?? '',
  }
  if (options?.overwrite) {
    body.overwrite = true
  }
  const n = missionIdentity?.missionName?.trim()
  const m = missionIdentity?.mapSuffix?.trim()
  if (n && m) {
    body.mission_name = n
    body.map_suffix = m
  }
  return body
}

export async function buildMissionPBO(
  projectPath: string,
  outputPath?: string,
  missionIdentity?: { missionName: string; mapSuffix: string },
  options?: { overwrite?: boolean },
): Promise<BuildPboResult> {
  const body = buildPboPayload(projectPath, outputPath, missionIdentity, options)
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('build-mission-pbo', body)) as BuildPboResult
    return {
      ok: data?.ok === true,
      pboPath: typeof data?.pboPath === 'string' ? data.pboPath : undefined,
      log: Array.isArray(data?.log) ? data.log : [],
      error: typeof data?.error === 'string' ? data.error : undefined,
      code: typeof data?.code === 'string' ? data.code : undefined,
    }
  }

  const response = await fetch(apiUrl('/api/build-mission-pbo'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ ...body, stream: false }),
  })
  const data = (await response.json().catch(() => ({}))) as BuildPboResult & {
    error?: string
    code?: string
  }
  if (response.status === 409 && data.code === 'pbo_exists') {
    return {
      ok: false,
      code: 'pbo_exists',
      pboPath: typeof data.pboPath === 'string' ? data.pboPath : undefined,
      error: data.error,
    }
  }
  if (!response.ok) {
    return { ok: false, error: data.error ?? response.statusText }
  }
  return { ok: true, pboPath: data.pboPath, log: data.log }
}

export async function buildMissionPBOStream(
  projectPath: string,
  outputPath: string | undefined,
  onEvent: (ev: BuildPboStreamEvent) => void,
  missionIdentity?: { missionName: string; mapSuffix: string },
  options?: { overwrite?: boolean },
): Promise<void> {
  const body = buildPboPayload(projectPath, outputPath, missionIdentity, options)
  const ipc = getElectronIpc()
  if (ipc) {
    const data = (await ipc.invoke('build-mission-pbo', body)) as BuildPboResult
    if (data?.code === 'pbo_exists') {
      throw new PboOutputExistsError(
        typeof data.pboPath === 'string' ? data.pboPath : '',
        typeof data.error === 'string' ? data.error : undefined,
      )
    }
    if (!data?.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Could not build mission PBO.')
    }
    for (const line of Array.isArray(data.log) ? data.log : []) {
      onEvent({ type: 'log', message: line })
    }
    if (typeof data.pboPath === 'string') {
      onEvent({ type: 'done', pboPath: data.pboPath })
      return
    }
    throw new Error('Build finished without a PBO output path.')
  }

  const response = await fetch(apiUrl('/api/build-mission-pbo'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (response.status === 409) {
    const data = (await response.json().catch(() => ({}))) as {
      code?: string
      pboPath?: string
      error?: string
    }
    if (data.code === 'pbo_exists') {
      throw new PboOutputExistsError(
        typeof data.pboPath === 'string' ? data.pboPath : '',
        typeof data.error === 'string' ? data.error : undefined,
      )
    }
    throw new Error(data.error ?? 'Request conflict (409).')
  }
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText)
    throw new Error(errText || response.statusText)
  }
  const ctype = response.headers.get('Content-Type') ?? ''
  if (!ctype.includes('ndjson') && !ctype.includes('x-ndjson')) {
    const text = await response.text()
    throw new Error(`Unexpected response (${ctype}): ${text.slice(0, 200)}`)
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let row: Record<string, unknown>
      try {
        row = JSON.parse(line) as Record<string, unknown>
      } catch {
        onEvent({ type: 'log', message: line })
        continue
      }
      const t = row.type
      if (t === 'log' && typeof row.message === 'string') {
        onEvent({ type: 'log', message: row.message })
      } else if (t === 'error' && typeof row.message === 'string') {
        onEvent({ type: 'error', message: row.message })
      } else if (t === 'done' && typeof row.pboPath === 'string') {
        onEvent({ type: 'done', pboPath: row.pboPath })
      }
    }
  }
  const tail = buf.trim()
  if (tail) {
    try {
      const tailObj = JSON.parse(tail) as Record<string, unknown>
      const tt = tailObj.type
      if (tt === 'log' && typeof tailObj.message === 'string') {
        onEvent({ type: 'log', message: tailObj.message })
      } else if (tt === 'error' && typeof tailObj.message === 'string') {
        onEvent({ type: 'error', message: tailObj.message })
      } else if (tt === 'done' && typeof tailObj.pboPath === 'string') {
        onEvent({ type: 'done', pboPath: tailObj.pboPath })
      }
    } catch {
      onEvent({ type: 'log', message: tail })
    }
  }
}
