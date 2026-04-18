import fs from 'node:fs';
import path from 'node:path';
import { shell, IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

type RevealPathPayload = {
  path?: unknown;
  targetPath?: unknown;
};

export async function handleRevealPath(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
) {
  const body = (args ?? {}) as RevealPathPayload;
  const targetRaw = typeof body.path === 'string' ? body.path : body.targetPath;
  const target = typeof targetRaw === 'string' ? targetRaw.trim() : '';
  if (!target) {
    return { ok: false, error: 'Missing or invalid path.' };
  }

  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: 'Path is not an existing file.' };
  }

  shell.showItemInFolder(resolved);
  return { ok: true };
}
