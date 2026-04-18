import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Launchpad from '../../Launchpad';
import { handleTestingLaunch } from './handleTestingLaunch';

type ManagedMissions = Record<string, Record<string, unknown>>;

function readManaged(ctx: Launchpad): ManagedMissions {
  try {
    const raw = JSON.parse(fs.readFileSync(ctx.managedMissionsFile, 'utf8')) as ManagedMissions;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeManaged(ctx: Launchpad, data: ManagedMissions): void {
  fs.mkdirSync(path.dirname(ctx.managedMissionsFile), { recursive: true });
  fs.writeFileSync(ctx.managedMissionsFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function rowForMission(ctx: Launchpad, missionId: string): Record<string, unknown> | null {
  const all = readManaged(ctx);
  const row = all[missionId];
  if (!row || typeof row !== 'object') return null;
  return row;
}

function missionProjectPath(row: Record<string, unknown>): string {
  return typeof row.project_path === 'string' ? row.project_path.trim() : '';
}

function runGit(cwd: string, args: string[]) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}

function runGh(cwd: string, args: string[]) {
  return spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}

export async function handleManagedScenarioModsGet(ctx: Launchpad, _event: Electron.IpcMainInvokeEvent, args: { id?: string }) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!missionId) return { error: 'Mission id is required.' };
  const row = rowForMission(ctx, missionId);
  if (!row) return { error: 'Mission not found.' };
  const mods = Array.isArray(row.launch_mods) ? row.launch_mods : [];
  return { ok: true, mods };
}

export async function handleManagedScenarioModsPost(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; mods?: unknown },
) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!missionId) return { error: 'Mission id is required.' };
  const all = readManaged(ctx);
  const row = all[missionId];
  if (!row || typeof row !== 'object') return { error: 'Mission not found.' };
  const mods = Array.isArray(args?.mods) ? args.mods : [];
  row.launch_mods = mods;
  all[missionId] = row;
  writeManaged(ctx, all);
  return { ok: true, mods };
}

export async function handleManagedScenarioLaunchPost(
  ctx: Launchpad,
  event: Electron.IpcMainInvokeEvent,
  args: { id?: string; extra_args?: string | string[] },
) {
  return handleTestingLaunch(ctx, event, {
    managed_scenario_id: args?.id,
    extra_args: args?.extra_args,
    autotest: false,
  });
}

export async function handleManagedScenarioUpdatePatch(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; patch?: Record<string, unknown> },
) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!missionId) return { error: 'Mission id is required.' };
  const patchRaw = args?.patch && typeof args.patch === 'object' ? args.patch : {};
  const patch = { ...patchRaw } as Record<string, unknown>;
  delete patch.ext_params;
  const all = readManaged(ctx);
  const row = all[missionId];
  if (!row || typeof row !== 'object') return { error: 'Mission not found.' };
  const updated = { ...row, ...patch } as Record<string, unknown>;
  delete updated.ext_params;
  all[missionId] = updated;
  writeManaged(ctx, all);
  return { ok: true, mission: { id: missionId, ...updated } };
}

export async function handleManagedScenarioDelete(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; delete_project_files?: boolean },
) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!missionId) return { error: 'Mission id is required.' };
  const all = readManaged(ctx);
  const row = all[missionId];
  if (!row || typeof row !== 'object') return { error: 'Mission not found.' };
  if (args?.delete_project_files === true) {
    const projectPath = missionProjectPath(row);
    if (projectPath && fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  }
  delete all[missionId];
  writeManaged(ctx, all);
  return { ok: true };
}

export async function handleMissionGitStatus(ctx: Launchpad, _event: Electron.IpcMainInvokeEvent, args: { id?: string }) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  const row = missionId ? rowForMission(ctx, missionId) : null;
  if (!row) return { ok: false, error: 'Mission not found.' };
  const cwd = missionProjectPath(row);
  if (!cwd) return { ok: false, error: 'Mission project path missing.' };
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0) return { ok: true, hasMissionRepo: false, hasGit: false, files: [], commits: [] };
  const branch = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const fileRows = runGit(cwd, ['status', '--porcelain']);
  const files = (fileRows.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2).trim(), path: line.slice(3).trim() }));
  const ghVersion = runGh(cwd, ['--version']);
  const ghAuth = ghVersion.status === 0 ? runGh(cwd, ['auth', 'status']) : { status: 1 };
  return {
    ok: true,
    hasMissionRepo: true,
    hasGit: true,
    missionGitRoot: 'mission',
    missionProjectPath: cwd,
    branch: (branch.stdout || '').trim() || 'HEAD',
    files,
    hasGhCli: ghVersion.status === 0,
    ghAuthenticated: ghAuth.status === 0,
  };
}

export async function handleMissionGitLog(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; limit?: number },
) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  const row = missionId ? rowForMission(ctx, missionId) : null;
  if (!row) return { ok: false, error: 'Mission not found.', commits: [] };
  const cwd = missionProjectPath(row);
  if (!cwd) return { ok: false, error: 'Mission project path missing.', commits: [] };
  const lim = Number.isFinite(args?.limit) ? Math.max(1, Math.min(200, Number(args.limit))) : 30;
  const res = runGit(cwd, ['log', `-n${lim}`, '--pretty=format:%H%x1f%s%x1f%an%x1f%ad']);
  if (res.status !== 0) return { ok: true, commits: [], skipped: true };
  const commits = (res.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, subject, author, date] = line.split('\x1f');
      return { hash, subject, author, date };
    });
  return { ok: true, commits, missionGitRoot: 'mission' };
}

export async function handleMissionGitInit(ctx: Launchpad, _event: Electron.IpcMainInvokeEvent, args: { id?: string }) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  const row = missionId ? rowForMission(ctx, missionId) : null;
  if (!row) return { ok: false, error: 'Mission not found.' };
  const cwd = missionProjectPath(row);
  if (!cwd) return { ok: false, error: 'Mission project path missing.' };
  const exists = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (exists.status === 0) return { ok: true, already: true, message: 'Repository already initialized.' };
  const init = runGit(cwd, ['init']);
  if (init.status !== 0) return { ok: false, error: (init.stderr || init.stdout || 'git init failed').trim() };
  return { ok: true, message: 'Repository initialized.' };
}

export async function handleMissionGitCommit(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; message?: string },
) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  const row = missionId ? rowForMission(ctx, missionId) : null;
  if (!row) return { ok: false, error: 'Mission not found.' };
  const cwd = missionProjectPath(row);
  if (!cwd) return { ok: false, error: 'Mission project path missing.' };
  const message = typeof args?.message === 'string' ? args.message.trim() : '';
  if (!message) return { ok: false, error: 'Commit message is required.' };
  runGit(cwd, ['add', '-A']);
  const commit = runGit(cwd, ['commit', '-m', message]);
  if (commit.status !== 0) {
    const out = `${commit.stderr || ''}\n${commit.stdout || ''}`.trim();
    return { ok: false, error: out || 'git commit failed' };
  }
  return { ok: true, summary: (commit.stdout || '').trim() };
}

export async function handleMissionGitPublish(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; repo_name?: string; visibility?: 'public' | 'private'; description?: string },
) {
  const missionId = typeof args?.id === 'string' ? args.id.trim() : '';
  const row = missionId ? rowForMission(ctx, missionId) : null;
  if (!row) return { ok: false, error: 'Mission not found.' };
  const cwd = missionProjectPath(row);
  if (!cwd) return { ok: false, error: 'Mission project path missing.' };
  const repoName = typeof args?.repo_name === 'string' ? args.repo_name.trim() : '';
  if (!repoName) return { ok: false, error: 'Repository name is required.' };
  const vis = args?.visibility === 'public' ? 'public' : 'private';
  const desc = typeof args?.description === 'string' ? args.description.trim() : '';
  const ghArgs = ['repo', 'create', repoName, `--${vis}`, '--source', '.', '--remote', 'origin', '--push'];
  if (desc) ghArgs.push('--description', desc);
  const publish = runGh(cwd, ghArgs);
  if (publish.status !== 0) {
    return { ok: false, error: `${publish.stderr || publish.stdout || 'gh repo create failed'}`.trim() };
  }
  const origin = runGit(cwd, ['remote', 'get-url', 'origin']);
  return { ok: true, summary: (publish.stdout || '').trim(), originUrl: (origin.stdout || '').trim() || null };
}
