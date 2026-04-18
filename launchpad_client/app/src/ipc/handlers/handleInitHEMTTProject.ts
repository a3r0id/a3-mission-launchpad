import fs from 'node:fs';
import path from 'node:path';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

export type InitModProjectHemttPayload = {
  project_path?: unknown;
  projectPath?: unknown;
  /** Shown in HEMTT config and the main addon; defaults to the folder name. */
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  author?: unknown;
  prefix?: unknown;
  mainprefix?: unknown;
};

export type InitModProjectHemttResponse = {
  ok: boolean;
  /** True when new files were written; false when a project file was already present. */
  initialized?: boolean;
  project_path?: string;
  log?: string[];
  error?: string;
  code?: 'missing_path' | 'not_directory' | 'write_failed';
};

function readStringField(
  body: InitModProjectHemttPayload,
  snake: keyof InitModProjectHemttPayload,
  camel: keyof InitModProjectHemttPayload,
): string {
  const raw = body[snake] ?? body[camel];
  return typeof raw === 'string' ? raw.trim() : '';
}

function readOptionalString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** HEMTT ``new`` expects a single folder token: letters, digits, underscores (lowercase typical). */
export function hemttSafePrefixFromFolderName(folderName: string): string {
  const s = folderName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const base = s || 'mod';
  return /^[0-9]/.test(base) ? `mod_${base}` : base;
}

function escapeCppString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cfgPatchesClassFromPrefix(prefix: string): string {
  const up = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const body = up || 'MOD';
  return `${body}_main`;
}

export function hemttProjectTomlPath(projectRoot: string): string {
  return path.join(projectRoot, '.hemtt', 'project.toml');
}

export function isHemttProjectRoot(projectRoot: string): boolean {
  try {
    return fs.existsSync(hemttProjectTomlPath(projectRoot));
  } catch {
    return false;
  }
}

const defaultGitignore = `*.pbo
.hemttout
hemtt
hemtt.exe
*.biprivatekey
*.hemttprivatekey
`;

/**
 * Writes a minimal HEMTT 1.x layout (``.hemtt/project.toml``, ``addons/main``, ``.gitignore``).
 * ``hemtt new`` requires a TTY and cannot be scripted here; this scaffold matches what ``hemtt build`` expects.
 */
export function ensureHemttProjectScaffold(
  projectRoot: string,
  options?: {
    displayName?: string;
    author?: string;
    prefix?: string;
    mainprefix?: string;
  },
): InitModProjectHemttResponse {
  const log: string[] = [];
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return {
      ok: false,
      code: 'not_directory',
      error: 'Project path not found or not a directory.',
      log,
    };
  }

  if (isHemttProjectRoot(resolved)) {
    log.push('This folder is already a HEMTT project.');
    return { ok: true, initialized: false, project_path: resolved, log };
  }

  const folderBase = path.basename(resolved);
  const prefix = (options?.prefix?.trim() || hemttSafePrefixFromFolderName(folderBase)).trim() || 'mod';
  const mainprefix = (options?.mainprefix?.trim() || 'z').trim() || 'z';
  const displayName = (options?.displayName?.trim() || folderBase).trim() || folderBase;
  const author = (options?.author?.trim() || 'Local').trim() || 'Local';

  const pboprefixLine = `${mainprefix}\\${prefix}\\addons\\main`;
  const patchClass = cfgPatchesClassFromPrefix(prefix);
  const cppName = escapeCppString(displayName);

  const projectToml =
    `name = ${JSON.stringify(displayName)}\n` +
    `author = ${JSON.stringify(author)}\n` +
    `prefix = ${JSON.stringify(prefix)}\n` +
    `mainprefix = ${JSON.stringify(mainprefix)}\n` +
    '\n' +
    '[version]\n' +
    'major = 0\n' +
    'minor = 0\n' +
    'patch = 1\n' +
    'build = 0\n' +
    'git_hash = 0\n';

  const configCpp =
    `// Starter addon created by Launchpad for HEMTT builds.\n` +
    `class CfgPatches {\n` +
    `  class ${patchClass} {\n` +
    `    name = "${cppName}";\n` +
    `    units[] = {};\n` +
    `    weapons[] = {};\n` +
    `    requiredVersion = 0.1;\n` +
    `    requiredAddons[] = {};\n` +
    `  };\n` +
    `};\n`;

  try {
    fs.mkdirSync(path.join(resolved, '.hemtt'), { recursive: true });
    fs.mkdirSync(path.join(resolved, 'addons', 'main'), { recursive: true });
    fs.writeFileSync(path.join(resolved, '.hemtt', 'project.toml'), projectToml, 'utf8');
    fs.writeFileSync(path.join(resolved, 'addons', 'main', '$PBOPREFIX$'), `${pboprefixLine}\n`, 'utf8');
    fs.writeFileSync(path.join(resolved, 'addons', 'main', 'config.cpp'), configCpp, 'utf8');
    fs.writeFileSync(path.join(resolved, '.gitignore'), defaultGitignore, 'utf8');
  } catch (err) {
    return {
      ok: false,
      code: 'write_failed',
      error: err instanceof Error ? err.message : 'Could not write HEMTT project files.',
      log,
    };
  }

  log.push('Created HEMTT project files and a starter addon.');
  return { ok: true, initialized: true, project_path: resolved, log };
}

export async function handleInitHEMTTProject(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<InitModProjectHemttResponse> {
  const body = (args ?? {}) as InitModProjectHemttPayload;
  const projectRaw = readStringField(body, 'project_path', 'projectPath');
  if (!projectRaw) {
    return { ok: false, code: 'missing_path', error: 'Missing or invalid project path.' };
  }

  const displayName =
    readOptionalString(body.name) ||
    readStringField(body, 'display_name', 'displayName') ||
    undefined;
  const author = readOptionalString(body.author) || undefined;
  const prefix = readOptionalString(body.prefix) || undefined;
  const mainprefix = readOptionalString(body.mainprefix) || undefined;

  return ensureHemttProjectScaffold(projectRaw, {
    displayName: displayName || undefined,
    author,
    prefix,
    mainprefix,
  });
}
