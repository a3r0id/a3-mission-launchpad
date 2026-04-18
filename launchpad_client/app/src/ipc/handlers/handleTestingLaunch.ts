import fs from 'node:fs';
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
        pbo: path.join(root, 'addons', 'a3_launchpad_ext_core.pbo'),
        looseFn: path.join(root, 'addons', 'a3_launchpad_ext_core', 'functions', 'fn_init.sqf'),
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

function syncCompanionModToDataDir(ctx: Launchpad, gameRootRaw: string): { path?: string; warning?: string } {
  const dataModPath = path.join(ctx.dataDir, 'mod');
  const stagingSource = resolveCompanionStagingSourcePath(ctx, gameRootRaw);
  if (!stagingSource) {
    const fallback = resolveCompanionModPath(ctx, gameRootRaw);
    if (fallback) return { path: fallback };
    return { warning: 'Companion extension is enabled, but its staged mod folder was not found.' };
  }
  try {
    fs.mkdirSync(ctx.dataDir, { recursive: true });
    const mirror = mirrorDirectoryBestEffort(stagingSource, dataModPath);
    if (!hasCompanionPayload(dataModPath)) {
      return { warning: 'Companion extension sync completed, but payload was not found under launchpad_data/mod.' };
    }
    if (mirror.busySkipped > 0) {
      return {
        path: dataModPath,
        warning: `Companion mod sync reused ${mirror.busySkipped} locked file(s) already in launchpad_data/mod.`,
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

function resolveModPath(modPathRaw: string, gameRootRaw: string): string | null {
  const m = modPathRaw.trim();
  if (!m) return null;
  if (path.isAbsolute(m) && fs.existsSync(m)) return path.resolve(m);
  const gameRoot = gameRootRaw.trim();
  if (!gameRoot) return null;
  const joined = path.join(path.resolve(gameRoot), m);
  if (fs.existsSync(joined)) return joined;
  return null;
}

function getEnabledLaunchMods(ctx: Launchpad, row: ManagedMissionRow, gameRoot: string): string[] {
  const direct = Array.isArray(row.launch_mods) ? row.launch_mods : [];
  const fallback = readJsonFile<{ mods?: unknown }>(path.join(ctx.dataDir, 'testing_modlist.json'), { mods: [] });
  const source = direct.length > 0 ? direct : (Array.isArray(fallback.mods) ? fallback.mods : []);
  const out: string[] = [];
  for (const item of source) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    if (obj.enabled === false) continue;
    const resolved = resolveModPath(typeof obj.path === 'string' ? obj.path : '', gameRoot);
    if (resolved) out.push(resolved);
  }
  return out;
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
  const exeRow = getArmaExePath(gameRoot);
  if (!exeRow.exe) {
    return { error: exeRow.error ?? 'Could not resolve Arma 3 executable.' };
  }

  const modPaths = getEnabledLaunchMods(ctx, row, gameRoot);
  const useCompanionExtension = body.use_companion_extension === true;
  let companionWarning: string | null = null;
  if (useCompanionExtension) {
    const companionSync = syncCompanionModToDataDir(ctx, gameRoot);
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

  const profileName = profileNameFromPath(row.profile_path);
  const argv = buildArmaLaunchArgv({
    exePath: exeRow.exe,
    profileName,
    modPaths,
    extraArgs: extra.args,
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
