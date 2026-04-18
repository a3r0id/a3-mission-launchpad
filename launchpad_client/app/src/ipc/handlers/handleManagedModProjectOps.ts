import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Launchpad from '../../Launchpad';

type ManagedModProjects = Record<string, Record<string, unknown>>;

/** Folder segment rules (aligned with mission project folder tokens). */
function validateFolderName(part: string, label: string): string | null {
  const s = part.trim();
  if (!s) return `${label} cannot be empty.`;
  if (s === '.' || s === '..') return `${label} is not a valid folder name.`;
  if (s.includes('/') || s.includes('\\') || s.includes('\0')) {
    return `${label} cannot contain path separators.`;
  }
  return null;
}

function readManaged(ctx: Launchpad): ManagedModProjects {
  try {
    const raw = JSON.parse(fs.readFileSync(ctx.managedModProjectsFile, 'utf8')) as ManagedModProjects;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeManaged(ctx: Launchpad, data: ManagedModProjects): void {
  fs.mkdirSync(path.dirname(ctx.managedModProjectsFile), { recursive: true });
  fs.writeFileSync(ctx.managedModProjectsFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function modProjectPath(row: Record<string, unknown>): string {
  return typeof row.project_path === 'string' ? row.project_path.trim() : '';
}

function projectPathUsedByAnother(all: ManagedModProjects, absPath: string, excludeId: string): boolean {
  const norm = path.normalize(absPath);
  for (const [id, row] of Object.entries(all)) {
    if (id === excludeId || !row || typeof row !== 'object') continue;
    const p = modProjectPath(row);
    if (p && path.normalize(p) === norm) return true;
  }
  return false;
}

export async function handleManagedModProjectCreate(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { name?: unknown; description?: unknown },
) {
  const nameRaw = typeof args?.name === 'string' ? args.name : '';
  const nameErr = validateFolderName(nameRaw, 'Project name');
  if (nameErr) return { error: nameErr };
  const folderName = nameRaw.trim();
  const description =
    typeof args?.description === 'string' ? args.description.trim() : '';

  const dataDir = ctx.dataDir;
  const projectsRoot = path.join(dataDir, 'mod_projects');
  const projectPath = path.join(projectsRoot, folderName);

  if (fs.existsSync(projectPath)) {
    return { error: 'A folder with this name already exists under Mod projects.' };
  }

  const all = readManaged(ctx);
  if (projectPathUsedByAnother(all, projectPath, '')) {
    return { error: 'This project path is already registered.' };
  }

  try {
    fs.mkdirSync(projectPath, { recursive: true });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create project folder.' };
  }

  const id = randomUUID();
  const row = {
    name: folderName,
    description,
    project_path: projectPath,
  };
  all[id] = row;
  writeManaged(ctx, all);
  return { ok: true, project: { id, ...row } };
}

export async function handleManagedModProjectUpdatePatch(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; patch?: Record<string, unknown> },
) {
  const projectId = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!projectId) return { error: 'Project id is required.' };
  const patch = args?.patch && typeof args.patch === 'object' ? args.patch : {};
  const all = readManaged(ctx);
  const row = all[projectId];
  if (!row || typeof row !== 'object') return { error: 'Project not found.' };

  // v1: only update display fields. On-disk folder name is not renamed (see plan).
  const next = { ...row };
  if ('name' in patch) {
    const n = typeof patch.name === 'string' ? patch.name.trim() : '';
    const err = validateFolderName(n, 'Name');
    if (err) return { error: err };
    next.name = n;
  }
  if ('description' in patch) {
    next.description = typeof patch.description === 'string' ? patch.description.trim() : '';
  }

  all[projectId] = next;
  writeManaged(ctx, all);
  return { ok: true, project: { id: projectId, ...next } };
}

export async function handleManagedModProjectDelete(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: { id?: string; delete_project_files?: boolean },
) {
  const projectId = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!projectId) return { error: 'Project id is required.' };
  const all = readManaged(ctx);
  const row = all[projectId];
  if (!row || typeof row !== 'object') return { error: 'Project not found.' };
  if (args?.delete_project_files === true) {
    const projectPath = modProjectPath(row);
    if (projectPath && fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()) {
      fs.rmSync(projectPath, { recursive: true, force: true });
    }
  }
  delete all[projectId];
  writeManaged(ctx, all);
  return { ok: true };
}
