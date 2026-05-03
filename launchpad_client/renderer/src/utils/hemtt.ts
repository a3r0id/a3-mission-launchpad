import { getElectronIpc } from '../electronIpc'

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

export type InitModProjectHemttResult = {
  ok: boolean
  initialized?: boolean
  project_path?: string
  log?: string[]
  error?: string
  code?: 'missing_path' | 'not_directory' | 'write_failed' | string
}

export type LintModProjectHemttResult = {
  ok: boolean
  exitCode?: number
  diagnostics: HemttDiagnostic[]
  log?: string[]
  error?: string
  code?: 'hemtt_missing' | 'hemtt_failed' | string
}

export async function initModProjectHemtt(
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

export async function buildModProjectHemtt(
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

export async function lintModProjectHemtt(projectPath: string): Promise<LintModProjectHemttResult> {
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
