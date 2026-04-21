import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';
import { buildArmaLaunchArgv, launchArma3 } from '../../arma/launchArma3';

type TestingLaunchPayload = {
  managed_scenario_id?: unknown;
  mission_id?: unknown;
  extra_args?: unknown;
  use_companion_extension?: unknown;
  autotest?: unknown;
  autotest_config?: unknown;
  autotest_spec?: unknown;
};

type TestingLaunchResult = {
  ok?: boolean;
  error?: string;
  pid?: number;
  argv?: string[];
  missionFolderName?: string;
  autotestWatchId?: string;
  autotestFilePath?: string;
  message?: string;
};

type ManagedMissionRow = {
  name?: unknown;
  map_suffix?: unknown;
  profile_path?: unknown;
  launch_mods?: unknown;
};

function hasCompanionPayload(root: string): boolean {
  try {
    const checks: { pbo: string; looseFn: string }[] = [
      {
        pbo: path.join(root, 'addons', 'a3_launchpad_ext_main.pbo'),
        looseFn: path.join(root, 'addons', 'a3_launchpad_ext_main', 'functions', 'fnc_init.sqf'),
      },
      {
        pbo: path.join(root, 'addons', 'a3_launchpad_ext_main.pbo'),
        looseFn: path.join(root, 'addons', 'a3_launchpad_ext_main', 'functions', 'fn_init.sqf'),
      },
    ];
    for (const { pbo, looseFn } of checks) {
      if (fs.existsSync(pbo) && fs.statSync(pbo).isFile()) return true;
      if (fs.existsSync(looseFn) && fs.statSync(looseFn).isFile()) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function resolveCompanionModPath(ctx: Launchpad, gameRootRaw: string): string | null {
  const gameRoot = gameRootRaw.trim();
  const cwd = process.cwd();
  const repoLikeFromCwd = path.resolve(cwd, '..', '..', '..', 'A3LaunchPad', 'mod');
  const repoLikeFromSrc = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'A3LaunchPad', 'mod');
  const workspacePackagedMod = path.resolve(cwd, 'A3LaunchPad', 'mod');
  const workspaceLaunchpadMod = path.resolve(cwd, 'launchpad_mod');
  const workspaceLaunchpadModMod = path.resolve(cwd, 'launchpad_mod', 'mod');
  const candidates = [
    // Packaged app/runtime locations
    path.join(process.resourcesPath, 'mod'),
    path.join(process.resourcesPath, '..', 'mod'),
    // Common development workspace locations
    workspacePackagedMod,
    repoLikeFromCwd,
    repoLikeFromSrc,
    workspaceLaunchpadModMod,
    workspaceLaunchpadMod,
    path.resolve(cwd, 'A3LaunchPad', 'mod'),
    // Optional fallback if user manually copied mod under data dir
    path.join(ctx.dataDir, 'mod'),
    // Arma install-relative fallbacks
    gameRoot ? path.join(path.resolve(gameRoot), '@A3LaunchPad') : '',
    gameRoot ? path.join(path.resolve(gameRoot), 'A3LaunchPad', 'mod') : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return path.resolve(candidate);
      }
    } catch {
      // ignore invalid candidates
    }
  }
  return null;
}

function resolveCompanionStagingSourcePath(ctx: Launchpad, gameRootRaw: string): string | null {
  const gameRoot = gameRootRaw.trim();
  const cwd = process.cwd();
  const dataModPath = path.join(ctx.dataDir, 'mod');
  const repoRootFromApp = path.resolve(cwd, '..', '..');
  const repoLaunchpadModBinMod = path.resolve(repoRootFromApp, 'launchpad_mod', 'bin', 'mod');
  const repoLaunchpadMod = path.resolve(repoRootFromApp, 'launchpad_mod');
  const armaA3LaunchPadMod = gameRoot ? path.join(path.resolve(gameRoot), '@A3LaunchPad', 'mod') : '';
  const repoLikeFromCwd = path.resolve(cwd, '..', '..', '..', 'A3LaunchPad', 'mod');
  const repoLikeFromSrc = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'A3LaunchPad', 'mod');
  const workspacePackagedMod = path.resolve(cwd, 'A3LaunchPad', 'mod');
  const workspaceLaunchpadMod = path.resolve(cwd, 'launchpad_mod');
  const workspaceLaunchpadModMod = path.resolve(cwd, 'launchpad_mod', 'mod');
  const candidates = [
    // Dev-first: local repo mod layouts
    repoLaunchpadModBinMod,
    repoLaunchpadMod,
    workspaceLaunchpadModMod,
    workspaceLaunchpadMod,
    // Arma installation mod, if user already staged it there
    armaA3LaunchPadMod,
    // Packaged / staging layouts
    path.join(process.resourcesPath, 'mod'),
    path.join(process.resourcesPath, '..', 'mod'),
    workspacePackagedMod,
    repoLikeFromCwd,
    repoLikeFromSrc,
    path.resolve(cwd, 'A3LaunchPad', 'mod'),
    gameRoot ? path.join(path.resolve(gameRoot), '@A3LaunchPad') : '',
    gameRoot ? path.join(path.resolve(gameRoot), 'A3LaunchPad', 'mod') : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
      if (path.resolve(candidate).toLowerCase() === path.resolve(dataModPath).toLowerCase()) continue;
      if (!hasCompanionPayload(candidate)) continue;
      return path.resolve(candidate);
    } catch {
      // ignore invalid candidates
    }
  }
  return null;
}

function isBusyFsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

/** Native extension filenames (CMake ``OUTPUT_NAME`` + platform suffix). */
const COMPANION_EXT_BINARIES = ['A3_LAUNCHPAD_EXT_x64.dll', 'A3_LAUNCHPAD_EXT_x64.so'] as const;

/**
 * Copy extension binaries next to ``launchpad_data/mod/`` (same layout as packaged ``resources/``):
 * ``launchpad_data/A3_LAUNCHPAD_EXT_x64.(dll|so)`` from the parent of the staged mod folder, or legacy path inside the mod folder.
 */
function syncCompanionNativeBinaries(stagingModDir: string, dataDir: string): void {
  const resolvedMod = path.resolve(stagingModDir);
  const parent = path.dirname(resolvedMod);
  for (const name of COMPANION_EXT_BINARIES) {
    const dest = path.join(dataDir, name);
    for (const base of [parent, resolvedMod]) {
      const src = path.join(base, name);
      try {
        if (fs.existsSync(src) && fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
          break;
        }
      } catch {
        // try next base
      }
    }
  }
}

function mirrorDirectoryBestEffort(sourceDir: string, targetDir: string): { copied: number; busySkipped: number } {
  fs.mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  let busySkipped = 0;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const nested = mirrorDirectoryBestEffort(src, dst);
      copied += nested.copied;
      busySkipped += nested.busySkipped;
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        const realSource = fs.realpathSync(src);
        const st = fs.statSync(realSource);
        if (st.isDirectory()) {
          const nested = mirrorDirectoryBestEffort(realSource, dst);
          copied += nested.copied;
          busySkipped += nested.busySkipped;
        } else {
          fs.copyFileSync(realSource, dst);
          copied += 1;
        }
      } catch (err) {
        if (isBusyFsError(err)) {
          busySkipped += 1;
          continue;
        }
        throw err;
      }
      continue;
    }
    try {
      fs.copyFileSync(src, dst);
      copied += 1;
    } catch (err) {
      if (isBusyFsError(err)) {
        busySkipped += 1;
        continue;
      }
      throw err;
    }
  }
  return { copied, busySkipped };
}

function pruneLegacyCompanionArtifacts(targetModDir: string): void {
  const addonsDir = path.join(targetModDir, 'addons');
  const legacyTargets = [
    path.join(addonsDir, 'a3_launchpad_ext_main.pbo'),
    path.join(addonsDir, 'a3_launchpad_ext_main'),
    path.join(addonsDir, 'a3_launchpad_ext_main', 'functions', 'fn_init.sqf'),
    path.join(addonsDir, 'a3_launchpad_ext_main', 'functions', 'fn_onIpcInbound.sqf'),
  ];
  for (const target of legacyTargets) {
    try {
      if (!fs.existsSync(target)) continue;
      const st = fs.statSync(target);
      if (st.isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.rmSync(target, { force: true });
      }
    } catch {
      // best effort cleanup only
    }
  }
}

async function syncCompanionModToDataDir(ctx: Launchpad, gameRootRaw: string): Promise<{ path?: string; warning?: string }> {
  const dataModPath = path.join(ctx.dataDir, 'mod');
  const stagingSource = resolveCompanionStagingSourcePath(ctx, gameRootRaw);
  if (!stagingSource) {
    const fallback = resolveCompanionModPath(ctx, gameRootRaw);
    if (fallback) return { path: fallback };
    return { warning: 'Companion extension is enabled, but its staged mod folder was not found.' };
  }
  try {
    await fsp.mkdir(ctx.dataDir, { recursive: true });
    pruneLegacyCompanionArtifacts(dataModPath);
    let busySkipped = 0;
    try {
      await fsp.cp(stagingSource, dataModPath, { recursive: true, force: true });
    } catch {
      const mirror = mirrorDirectoryBestEffort(stagingSource, dataModPath);
      busySkipped = mirror.busySkipped;
    }
    syncCompanionNativeBinaries(stagingSource, ctx.dataDir);
    if (!hasCompanionPayload(dataModPath)) {
      return {
        warning:
          'Companion extension sync completed, but addon payload was not found under launchpad_data/mod/addons.',
      };
    }
    if (busySkipped > 0) {
      return {
        path: dataModPath,
        warning: `Companion mod sync reused ${busySkipped} locked file(s) already under launchpad_data/mod.`,
      };
    }
    return { path: dataModPath };
  } catch (err) {
    const fallback = resolveCompanionModPath(ctx, gameRootRaw);
    if (fallback) {
      return {
        path: fallback,
        warning: `Companion mod sync to launchpad_data failed (${err instanceof Error ? err.message : String(err)}).`,
      };
    }
    return { warning: `Companion mod sync to launchpad_data failed (${err instanceof Error ? err.message : String(err)}).` };
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function expandEnvVars(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? '');
}

function parseExtraArgs(input: unknown): { args: string[]; error?: string } {
  if (input == null) return { args: [] };
  if (Array.isArray(input)) {
    const out: string[] = [];
    for (const token of input) {
      if (typeof token !== 'string') return { args: [], error: 'extra_args array must contain strings only.' };
      const t = token.trim();
      if (t) out.push(t);
    }
    return { args: out };
  }
  if (typeof input !== 'string') return { args: [], error: 'extra_args must be a string or string array.' };

  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const raw = match[1] ?? match[2] ?? match[0];
    const token = raw.replace(/\\(["'\\])/g, '$1').trim();
    if (token) out.push(token);
  }
  return { args: out };
}

function hasArmaArg(args: string[], key: string): boolean {
  const needle = key.trim().toLowerCase();
  if (!needle) return false;
  return args.some((arg) => {
    const token = arg.trim().toLowerCase();
    return token === needle || token.startsWith(`${needle}=`);
  });
}

function readBaseLaunchArgs(settings: Record<string, unknown>): { args: string[]; error?: string } {
  const candidates: unknown[] = [
    settings.arma3_launch_args,
    settings.arma3_args,
    settings.launch_args,
    settings.default_launch_args,
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = parseExtraArgs(candidate);
    if (parsed.error) return parsed;
    if (parsed.args.length > 0) return parsed;
  }
  return { args: [] };
}

function getArmaExePath(gameRootRaw: string): { exe?: string; error?: string } {
  const gameRoot = gameRootRaw.trim();
  if (!gameRoot) return { error: 'Arma 3 path is not configured.' };
  const root = path.resolve(gameRoot);
  const candidates = [path.join(root, 'arma3_x64.exe'), path.join(root, 'arma3.exe')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { exe: c };
  }
  return { error: `Could not find Arma 3 executable under ${root}.` };
}

function profileNameFromPath(profilePathRaw: unknown): string {
  if (typeof profilePathRaw !== 'string') return '';
  const trimmed = profilePathRaw.trim();
  if (!trimmed) return '';
  return path.basename(path.resolve(trimmed));
}

/** Placeholders so splitting on `:` (Linux) does not break `https://` in mod lists. */
const SPLIT_MASK_HTTPS = '__LP_SPLIT_HTTPS__';
const SPLIT_MASK_HTTP = '__LP_SPLIT_HTTP__';

function splitModPathTokens(modPathRaw: string): string[] {
  const trimmed = modPathRaw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return [];
  let value = /^-mod=/i.test(trimmed) ? trimmed.slice(5) : trimmed;
  value = value.replace(/https:\/\//gi, SPLIT_MASK_HTTPS).replace(/http:\/\//gi, SPLIT_MASK_HTTP);
  const sep = process.platform === 'win32' ? ';' : ':';
  return value
    .split(sep)
    .map((part) =>
      part
        .trim()
        .replace(/^["']|["']$/g, '')
        .replaceAll(SPLIT_MASK_HTTPS, 'https://')
        .replaceAll(SPLIT_MASK_HTTP, 'http://'),
    )
    .filter(Boolean);
}

const STEAM_ARMA3_APPID = '107410';

/** Fix strings that were split on `:` inside `http://` (e.g. `http;//steam…`). */
function normalizeBrokenUrlSchemes(input: string): string {
  return input.replace(/(https?);\/\//gi, '$1://');
}

function extractSteamWorkshopId(input: string): string | null {
  const s = input.trim();
  const patterns = [
    /(?:\?|&)id=(\d{6,})/i,
    /filedetails\/(\d{6,})/i,
    /workshop\/files\/\/?\?id=(\d{6,})/i,
    /CommunityFilePage\/(\d{6,})/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

function enumerateWorkshopContentRoots(gameRootRaw: string, workshopRootRaw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const key = path.resolve(p).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(path.resolve(p));
  };

  const gameRoot = gameRootRaw.trim();
  if (gameRoot) {
    const steamapps = path.resolve(path.join(path.resolve(gameRoot), '..', '..'));
    add(path.join(steamapps, 'workshop', 'content', STEAM_ARMA3_APPID));
  }

  const ws = expandEnvVars(workshopRootRaw.trim());
  if (ws) {
    const resolved = path.resolve(ws);
    const candidates = [
      resolved,
      path.join(resolved, STEAM_ARMA3_APPID),
      path.join(resolved, 'content', STEAM_ARMA3_APPID),
      path.join(resolved, 'workshop', 'content', STEAM_ARMA3_APPID),
    ];
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isDirectory()) add(c);
      } catch {
        // ignore
      }
    }
  }
  return out;
}

function resolveSteamWorkshopToDiskPath(id: string, gameRootRaw: string, workshopRootRaw: string): string | null {
  if (!/^\d+$/.test(id)) return null;
  for (const root of enumerateWorkshopContentRoots(gameRootRaw, workshopRootRaw)) {
    const full = path.join(root, id);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return path.resolve(full);
    } catch {
      // ignore
    }
  }
  return null;
}

function isWorkshopModFolderToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  if (t.includes('/') || t.includes('\\')) return false;
  if (t.includes('..')) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/^steam:/i.test(t)) return false;
  return /^@?[A-Za-z0-9_.-]+$/.test(t);
}

function resolveOneModToken(tokenRaw: string, gameRootRaw: string, workshopRootRaw: string): string | null {
  const token = expandEnvVars(normalizeBrokenUrlSchemes(tokenRaw.trim()));
  if (!token) return null;

  const workshopId = extractSteamWorkshopId(token);
  if (workshopId) {
    const disk = resolveSteamWorkshopToDiskPath(workshopId, gameRootRaw, workshopRootRaw);
    if (disk) return disk;
  }

  if (/^https?:\/\//i.test(token) || /steamcommunity\.com/i.test(token) || /^steam:\/\//i.test(token)) {
    return null;
  }

  if (path.isAbsolute(token)) {
    if (fs.existsSync(token)) return path.resolve(token);
    return token;
  }
  const gameRoot = gameRootRaw.trim();
  if (gameRoot) {
    const joined = path.join(path.resolve(gameRoot), token);
    if (fs.existsSync(joined)) return joined;
  }
  const workshopRaw = expandEnvVars(workshopRootRaw.trim());
  if (workshopRaw && isWorkshopModFolderToken(token)) {
    const folder = token.startsWith('@') ? token : `@${token}`;
    return path.resolve(path.join(path.resolve(workshopRaw), folder));
  }
  // Keep unresolved relative mod tokens (e.g. @CBA_A3) so Arma can resolve from game cwd.
  return token;
}

function collectEnabledLaunchMods(source: unknown, gameRoot: string, workshopRoot: string): string[] {
  const out: string[] = [];
  if (!Array.isArray(source)) return out;
  for (const item of source) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (obj.enabled === false) continue;
    const rawPath = typeof obj.path === 'string' ? obj.path : '';
    const parts = splitModPathTokens(rawPath);
    for (const part of parts) {
      const resolved = resolveOneModToken(part, gameRoot, workshopRoot);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}

function uniqueMods(mods: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const mod of mods) {
    const key = mod.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mod);
  }
  return out;
}

function getEnabledLaunchMods(ctx: Launchpad, row: ManagedMissionRow, gameRoot: string, workshopRoot: string): string[] {
  const direct = Array.isArray(row.launch_mods) ? row.launch_mods : [];
  const fallback = readJsonFile<{ mods?: unknown }>(path.join(ctx.dataDir, 'testing_modlist.json'), { mods: [] });
  const fromDirect = collectEnabledLaunchMods(direct, gameRoot, workshopRoot);
  if (fromDirect.length > 0) {
    return uniqueMods(fromDirect);
  }
  const fallbackRows = Array.isArray(fallback.mods) ? fallback.mods : [];
  return uniqueMods(collectEnabledLaunchMods(fallbackRows, gameRoot, workshopRoot));
}

function writeAutotestFile(ctx: Launchpad, missionId: string, missionFolder: string, specInput: unknown): { path?: string; error?: string } {
  if (!specInput || typeof specInput !== 'object' || Array.isArray(specInput)) {
    return { error: 'autotest_spec must be a JSON object.' };
  }
  const spec = specInput as Record<string, unknown>;
  const out: Record<string, unknown> = {
    mission_id: missionId,
    mission_folder: missionFolder,
    generated_ts: Date.now() / 1000,
  };
  if (typeof spec.label === 'string' && spec.label.trim()) out.label = spec.label.trim();
  if (typeof spec.iterations === 'number' && Number.isFinite(spec.iterations)) out.iterations = Math.floor(spec.iterations);
  if (typeof spec.max_duration_sec === 'number' && Number.isFinite(spec.max_duration_sec)) {
    out.max_duration_sec = Math.floor(spec.max_duration_sec);
  }
  if (Array.isArray(spec.tags)) {
    out.tags = spec.tags.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
  }

  const folder = path.join(ctx.dataDir, 'testing_autotest_temp');
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `autotest_${randomUUID()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
  return { path: filePath };
}

export async function handleTestingLaunch(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<TestingLaunchResult> {
  const body = (args ?? {}) as TestingLaunchPayload;
  const missionIdRaw = body.managed_scenario_id ?? body.mission_id;
  const missionId = typeof missionIdRaw === 'string' ? missionIdRaw.trim() : '';
  if (!missionId) {
    return { error: 'Field managed_scenario_id (string) is required.' };
  }

  const allMissions = readJsonFile<Record<string, ManagedMissionRow>>(ctx.managedMissionsFile, {});
  const row = allMissions[missionId];
  if (!row || typeof row !== 'object') {
    return { error: 'Mission not found.' };
  }
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const mapSuffix = typeof row.map_suffix === 'string' ? row.map_suffix.trim() : '';
  if (!name || !mapSuffix) {
    return { error: 'Mission is missing name or map_suffix.' };
  }
  const missionFolder = `${name}.${mapSuffix}`;

  const settings = readJsonFile<Record<string, unknown>>(ctx.settingsFile, {});
  const gameRoot = typeof settings.arma3_path === 'string' ? settings.arma3_path : '';
  const workshopRoot = typeof settings.arma3_workshop_path === 'string' ? settings.arma3_workshop_path : '';
  const exeRow = getArmaExePath(gameRoot);
  if (!exeRow.exe) {
    return { error: exeRow.error ?? 'Could not resolve Arma 3 executable.' };
  }

  const modPaths = getEnabledLaunchMods(ctx, row, gameRoot, workshopRoot);
  const useCompanionExtension = body.use_companion_extension === true;
  let companionWarning: string | null = null;
  if (useCompanionExtension) {
    const companionSync = await syncCompanionModToDataDir(ctx, gameRoot);
    const companionPath = companionSync.path;
    if (!companionPath) {
      companionWarning = companionSync.warning ?? 'Companion extension is enabled, but its mod folder was not found. Launching without companion features.';
    } else if (companionSync.warning) {
      companionWarning = companionSync.warning;
    }
    if (companionPath && !modPaths.some((m) => m.toLowerCase() === companionPath.toLowerCase())) {
      modPaths.push(companionPath);
    }
  }
  const extra = parseExtraArgs(body.extra_args);
  if (extra.error) return { error: extra.error };

  const baseArgs = readBaseLaunchArgs(settings);
  if (baseArgs.error) return { error: baseArgs.error };
  const launchArgs = [...baseArgs.args, ...extra.args];
  const profileName =
    profileNameFromPath(row.profile_path) ||
    profileNameFromPath(settings.arma3_profile_path);
  const argv = buildArmaLaunchArgv({
    exePath: exeRow.exe,
    profileName: hasArmaArg(launchArgs, '-name') ? '' : profileName,
    modPaths,
    extraArgs: launchArgs,
    includeNosplash: !hasArmaArg(launchArgs, '-nosplash'),
  });

  const autotest = body.autotest === true;
  let autotestFilePath: string | undefined;
  let autotestWatchId: string | undefined;
  if (autotest) {
    if (body.autotest_spec !== undefined) {
      const file = writeAutotestFile(ctx, missionId, missionFolder, body.autotest_spec);
      if (!file.path) return { error: file.error ?? 'Could not write autotest file.' };
      autotestFilePath = file.path;
      argv.push(`-autotest=${file.path}`);
    } else if (typeof body.autotest_config === 'string' && body.autotest_config.trim()) {
      argv.push(`-autotest=${body.autotest_config.trim()}`);
    } else {
      argv.push('-autotest');
    }
    const appdataRaw = typeof settings.arma3_appdata_path === 'string' ? settings.arma3_appdata_path.trim() : '';
    const appdataPath = appdataRaw ? path.resolve(expandEnvVars(appdataRaw)) : '';
    const initialOffsets: Record<string, number> = {};
    if (appdataPath && fs.existsSync(appdataPath) && fs.statSync(appdataPath).isDirectory()) {
      try {
        for (const name of fs.readdirSync(appdataPath)) {
          if (!name.toLowerCase().endsWith('.rpt')) continue;
          const full = path.join(appdataPath, name);
          if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
          initialOffsets[full] = fs.statSync(full).size;
        }
      } catch {
        // keep empty offsets snapshot on scan failure
      }
    }
    autotestWatchId = randomUUID().replaceAll('-', '');
    ctx.autotestWatch = {
      watch_id: autotestWatchId,
      started_ts: Date.now() / 1000,
      mission_id: missionId,
      mission_folder: missionFolder,
      pid: -1,
      appdata: appdataPath || null,
      offsets: initialOffsets,
      carry: {},
      result: null,
      poll_count: 0,
    };
  }

  try {
    const pid = launchArma3(exeRow.exe, argv);
    if (autotest && ctx.autotestWatch) {
      ctx.autotestWatch.pid = pid;
    }
    return {
      ok: true,
      pid,
      argv,
      missionFolderName: missionFolder,
      ...(autotestWatchId ? { autotestWatchId } : {}),
      ...(autotestFilePath ? { autotestFilePath } : {}),
      message: `${
        companionWarning ? `${companionWarning} ` : ''
      }${
        "Started Arma 3. If the mission does not auto-load, open it from Scenarios " +
        `(folder name '${missionFolder}') — it should appear when symlinked into your profile.`}`,
    };
  } catch (err) {
    return { error: `Could not start Arma 3: ${err instanceof Error ? err.message : String(err)}` };
  }
}
