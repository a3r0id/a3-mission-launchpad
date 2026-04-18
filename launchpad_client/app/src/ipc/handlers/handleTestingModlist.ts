import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

type TestingModEntry = {
  id: string;
  path: string;
  enabled: boolean;
  label?: string;
};

type TestingModStore = {
  mods: TestingModEntry[];
};

type PostPayload = {
  mods?: unknown;
};

type PatchPayload = {
  updates?: unknown;
};

type PatchUpdate = {
  id: string;
  enabled?: boolean;
};

type ErrorResponse = {
  ok?: false;
  error: string;
};

function modlistFile(ctx: Launchpad): string {
  return path.join(ctx.dataDir, 'testing_modlist.json');
}

function readStore(ctx: Launchpad): TestingModStore {
  const file = modlistFile(ctx);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { mods?: unknown };
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.mods)) return { mods: [] };
    return {
      mods: raw.mods
        .map((row) => normalizeModRow(row, false))
        .filter((row): row is TestingModEntry => row !== null),
    };
  } catch {
    return { mods: [] };
  }
}

function writeStore(ctx: Launchpad, mods: TestingModEntry[]): void {
  const file = modlistFile(ctx);
  const payload: TestingModStore = { mods };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

function normalizeModRow(row: unknown, assignId: boolean): TestingModEntry | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const obj = row as Record<string, unknown>;
  const modPath = typeof obj.path === 'string' ? obj.path.trim() : '';
  if (!modPath) return null;
  const idIn = typeof obj.id === 'string' ? obj.id.trim() : '';
  const out: TestingModEntry = {
    id: idIn || (assignId ? randomUUID() : ''),
    path: modPath,
    enabled: obj.enabled !== false,
  };
  if (!out.id) return null;
  if (typeof obj.label === 'string' && obj.label.trim()) {
    out.label = obj.label.trim();
  }
  return out;
}

export async function handleTestingModlistGet(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
): Promise<TestingModStore> {
  return readStore(ctx);
}

export async function handleTestingModlistPost(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<TestingModStore | ErrorResponse> {
  const body = (args ?? {}) as PostPayload;
  if (!Array.isArray(body.mods)) {
    return { error: 'Field mods (array) is required.' };
  }
  const out: TestingModEntry[] = [];
  for (const item of body.mods) {
    const row = normalizeModRow(item, true);
    if (!row) {
      return { error: 'Each mod needs a valid path string.' };
    }
    out.push(row);
  }
  writeStore(ctx, out);
  return { mods: out };
}

export async function handleTestingModlistPatch(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<TestingModStore | ErrorResponse> {
  const body = (args ?? {}) as PatchPayload;
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return { error: 'Field updates (non-empty array) is required.' };
  }
  const store = readStore(ctx);
  const byId = new Map<string, TestingModEntry>();
  for (const row of store.mods) byId.set(row.id, { ...row });

  for (const raw of body.updates) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'Each update must be an object.' };
    }
    const update = raw as PatchUpdate;
    const uid = typeof update.id === 'string' ? update.id.trim() : '';
    if (!uid) return { error: 'Each update needs id (string).' };
    const existing = byId.get(uid);
    if (!existing) return { error: `Unknown mod id: '${uid}'.` };
    if ('enabled' in update) existing.enabled = update.enabled === true;
  }

  const merged = Array.from(byId.values());
  writeStore(ctx, merged);
  return { mods: merged };
}
