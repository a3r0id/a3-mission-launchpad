import fs from 'node:fs';
import Launchpad from '../../Launchpad';

type ManagedModProjectRow = {
  id: string;
  [key: string]: unknown;
};

export async function handleManagedModProjectsRequest(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
): Promise<ManagedModProjectRow[]> {
  const managedPath = ctx.managedModProjectsFile;
  try {
    const raw = JSON.parse(fs.readFileSync(managedPath, 'utf8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return [];
    const rows: ManagedModProjectRow[] = [];
    for (const [id, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      rows.push({ id, ...(value as Record<string, unknown>) });
    }
    return rows;
  } catch {
    return [];
  }
}
