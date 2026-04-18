/**
 * Utility class for the client.
 * Covers common IPC quirks and provides a high-level programming interface for the client.
 */
import { apiUrl } from './api/launchpad'
import { getElectronIpc } from './electronIpc'

const jsonHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
} as const

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

/** Result of ``Util.buildModProjectHemtt`` (HEMTT ``hemtt build`` on the Electron backend). */
export type BuildModProjectHemttResult = {
  ok: boolean
  pboPath?: string
  pboPaths?: string[]
  log?: string[]
  error?: string
  code?: 'pbo_exists' | 'hemtt_missing' | 'no_pbo_output' | 'hemtt_failed' | string
}

export type HemttDiagnostic = {
  severity: 'error' | 'warning' | 'info' | 'help'
  message: string
  file?: string
  line?: number
  column?: number
}

/** Result of ``Util.initModProjectHemtt`` (writes a minimal HEMTT layout when missing). */
export type InitModProjectHemttResult = {
  ok: boolean
  initialized?: boolean
  project_path?: string
  log?: string[]
  error?: string
  code?: 'missing_path' | 'not_directory' | 'write_failed' | string
}

/** Result of ``Util.lintModProjectHemtt`` (``hemtt check`` on the Electron backend). */
export type LintModProjectHemttResult = {
  ok: boolean
  exitCode?: number
  diagnostics: HemttDiagnostic[]
  log?: string[]
  error?: string
  code?: 'hemtt_missing' | 'hemtt_failed' | string
}

/** Server returned HTTP 409: target ``.pbo`` path already exists; user may confirm overwrite. */
export class PboOutputExistsError extends Error {
  readonly code = 'pbo_exists' as const
  readonly pboPath: string

  constructor(pboPath: string, message?: string) {
    super(message ?? `A PBO file already exists at the output path: ${pboPath}`)
    this.name = 'PboOutputExistsError'
    this.pboPath = pboPath
  }
}

class Util {
  private static buildPboPayload(
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

  static async runCommand(command: string) {
    const response = await fetch(apiUrl('/api/run-command'), {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ command }),
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to run command: ${errText || response.statusText}`)
    }
    const data = (await response.json()) as {
      stdout?: string
      stderr?: string
      returncode?: number
    }
    const out = [data.stdout, data.stderr].filter(Boolean).join('\n')
    return out || ''
  }

  static async getFileContents(path: string) {
    const ipc = getElectronIpc()
    if (ipc) {
      const data = (await ipc.invoke('file-get-contents', path)) as { content?: string; error?: string } | null
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response from desktop API.')
      }
      if (typeof data.error === 'string' && data.error.trim()) {
        throw new Error(data.error)
      }
      if (typeof data.content !== 'string') {
        throw new Error('Invalid file response')
      }
      return data.content
    }

    const q = new URLSearchParams({ path })
    const response = await fetch(apiUrl(`/api/file-contents?${q.toString()}`), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to get file contents: ${errText || response.statusText}`)
    }
    const data = (await response.json()) as { content?: string; error?: string }
    if (typeof data.content !== 'string') {
      throw new Error(data.error ?? 'Invalid file response')
    }
    return data.content
  }

  static async setFileContents(path: string, contents: string) {
    const ipc = getElectronIpc()
    if (ipc) {
      const data = (await ipc.invoke('file-set-contents', {
        path,
        contents,
      })) as { ok?: boolean; error?: string } | null
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response from desktop API.')
      }
      if (typeof data.error === 'string' && data.error.trim()) {
        throw new Error(data.error)
      }
      if (data.ok !== true) {
        throw new Error('Could not save file')
      }
      return
    }

    const response = await fetch(apiUrl('/api/file-contents'), {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ path, contents }),
    })
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to set file contents: ${errText || response.statusText}`)
    }
  }

  /** One-shot build; returns JSON (no streaming). */
  static async buildMissionPBO(
    projectPath: string,
    outputPath?: string,
    missionIdentity?: { missionName: string; mapSuffix: string },
    options?: { overwrite?: boolean },
  ): Promise<BuildPboResult> {
    const body = Util.buildPboPayload(projectPath, outputPath, missionIdentity, options)
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

    // Fallback for browser-only mode where Electron IPC is unavailable.
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

  /**
   * Desktop: ensures ``.hemtt/project.toml`` and a starter addon exist (``hemtt new`` is interactive-only).
   * Safe to call on an already-initialized project (no changes).
   */
  static async initModProjectHemtt(
    projectPath: string,
    options?: { name?: string; author?: string; prefix?: string; mainprefix?: string },
  ): Promise<InitModProjectHemttResult> {
    const body: Record<string, unknown> = {
      project_path: projectPath,
    }
    if (options?.name?.trim()) body.name = options.name.trim()
    if (options?.author?.trim()) body.author = options.author.trim()
    if (options?.prefix?.trim()) body.prefix = options.prefix.trim()
    if (options?.mainprefix?.trim()) body.mainprefix = options.mainprefix.trim()
    const ipc = getElectronIpc()
    if (!ipc) {
      return { ok: false, error: 'Initializing a mod project requires the Launchpad desktop app.' }
    }
    const data = (await ipc.invoke('init-mod-project-hemtt', body)) as InitModProjectHemttResult
    const initFlag = data?.initialized
    return {
      ok: data?.ok === true,
      initialized: typeof initFlag === 'boolean' ? initFlag : undefined,
      project_path: typeof data?.project_path === 'string' ? data.project_path : undefined,
      log: Array.isArray(data?.log) ? data.log : [],
      error: typeof data?.error === 'string' ? data.error : undefined,
      code: typeof data?.code === 'string' ? data.code : undefined,
    }
  }

  /** Desktop: runs ``hemtt build`` in the mod project folder; optional ``output_path`` copies the newest built PBO. */
  static async buildModProjectHemtt(
    projectPath: string,
    outputPath?: string,
    options?: { overwrite?: boolean },
  ): Promise<BuildModProjectHemttResult> {
    const body: Record<string, unknown> = {
      project_path: projectPath,
      output_path: outputPath?.trim() ?? '',
    }
    if (options?.overwrite) {
      body.overwrite = true
    }
    const ipc = getElectronIpc()
    if (ipc) {
      const data = (await ipc.invoke('build-mod-project-hemtt', body)) as BuildModProjectHemttResult
      return {
        ok: data?.ok === true,
        pboPath: typeof data?.pboPath === 'string' ? data.pboPath : undefined,
        pboPaths: Array.isArray(data?.pboPaths) ? (data.pboPaths as string[]) : undefined,
        log: Array.isArray(data?.log) ? data.log : [],
        error: typeof data?.error === 'string' ? data.error : undefined,
        code: typeof data?.code === 'string' ? data.code : undefined,
      }
    }
    return { ok: false, error: 'Mod project builds require the Launchpad desktop app.' }
  }

  /** Desktop: runs ``hemtt check`` in the mod project folder and returns structured diagnostics. */
  static async lintModProjectHemtt(projectPath: string): Promise<LintModProjectHemttResult> {
    const ipc = getElectronIpc()
    if (!ipc) {
      return {
        ok: false,
        diagnostics: [],
        error: 'Checking the project requires the Launchpad desktop app.',
      }
    }
    const data = (await ipc.invoke('lint-mod-project-hemtt', {
      project_path: projectPath,
    })) as LintModProjectHemttResult
    return {
      ok: data?.ok === true,
      exitCode: typeof data?.exitCode === 'number' ? data.exitCode : undefined,
      diagnostics: Array.isArray(data?.diagnostics) ? data.diagnostics : [],
      log: Array.isArray(data?.log) ? data.log : [],
      error: typeof data?.error === 'string' ? data.error : undefined,
      code: typeof data?.code === 'string' ? data.code : undefined,
    }
  }

  /**
   * Stream NDJSON events from the build (log lines, then done or error).
   */
  static async buildMissionPBOStream(
    projectPath: string,
    outputPath: string | undefined,
    onEvent: (ev: BuildPboStreamEvent) => void,
    missionIdentity?: { missionName: string; mapSuffix: string },
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const body = Util.buildPboPayload(projectPath, outputPath, missionIdentity, options)
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

    // Fallback for browser-only mode where Electron IPC is unavailable.
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

  static async revealPathInExplorer(path: string, projectPath?: string) {
    const ipc = getElectronIpc()
    if (ipc) {
      const data = (await ipc.invoke('reveal-path', {
        path,
        project_path: projectPath ?? '',
      })) as { ok?: boolean; error?: string }
      if (!data?.ok) {
        throw new Error(data?.error ?? 'Could not reveal path.')
      }
      return
    }

    // Fallback for browser-only mode where Electron IPC is unavailable.
    const response = await fetch(apiUrl('/api/reveal-path'), {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        path,
        project_path: projectPath ?? '',
      }),
    })
    const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? response.statusText)
    }
  }

  static async parseModlistFromHtml(fileName: string, html: string) {

    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const rows = doc.querySelectorAll('tr')
    const head = doc.querySelector('head')

    const modlist: {
      file: string,
      preset: string,
      type?: string,
      mods: { name: string; type: string; link: string, id: number }[]
    } = { file: fileName, preset: '', type: undefined, mods: [] }

    if (head) {
      const type = head.querySelector('meta[name="arma:Type"]')?.getAttribute('content')
      const preset = head.querySelector('meta[name="arma:PresetName"]')?.getAttribute('content')
      if (type && preset) {
        modlist.type = type
        modlist.preset = preset
      }
    }

    const seenIds = new Set<number>()
    for (const row of rows) {
      const containerType = (row.getAttribute('data-type') ?? '').trim()
      const nameCell = row.querySelector('td[data-type="DisplayName"], td:nth-child(1)')
      const typeCell = row.querySelector('td[data-type="Type"], td:nth-child(2)')
      const linkCell = row.querySelector('td[data-type="Link"], td:nth-child(3)')

      const name = (nameCell?.textContent ?? '').trim()
      const type = (typeCell?.textContent ?? '').trim()
      const linkAnchor = linkCell?.querySelector('a[href]')
      const href = (linkAnchor?.getAttribute('href') ?? '').trim()
      const linkText = (linkCell?.textContent ?? '').trim()
      const link = href || linkText

      // Keep strict enough to avoid random table rows but tolerate exporter layout differences.
      if (!link || (containerType && containerType !== 'ModContainer')) continue

      const idMatch = link.match(/[?&]id=(\d+)/i) ?? link.match(/\/filedetails\/\?id=(\d+)/i)
      const idRaw = idMatch?.[1] ?? ''
      if (!idRaw) continue
      const id = Number.parseInt(idRaw, 10)
      if (!Number.isFinite(id) || id <= 0 || seenIds.has(id)) continue

      seenIds.add(id)
      modlist.mods.push({ name, type, link, id })
    }
    return modlist
  }
}

export default Util
