import fs from 'node:fs';
import path from 'node:path';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

type ListRptPayload = {
  location?: unknown;
};

type ListRptResponse = {
  ok?: false;
  error?: string;
  folder?: string;
  rpt_files?: Array<{
    name: string;
    path: string;
    size: number;
    modified_ts: number;
  }>;
  location?: 'profile' | 'tools';
};

function expandEnvPath(input: string): string {
  return input.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? '');
}

function resolveRptFolder(settings: Record<string, unknown>, location: 'profile' | 'tools'): { folder?: string; error?: string } {
  if (location === 'tools') {
    const toolsRoot = typeof settings.arma3_tools_path === 'string' ? settings.arma3_tools_path.trim() : '';
    if (!toolsRoot) {
      return { error: 'Arma 3 Tools path is not configured.' };
    }
    const folder = path.resolve(expandEnvPath(path.join(toolsRoot, 'Logs')));
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      return { error: 'Arma 3 Tools Logs folder was not found.' };
    }
    return { folder };
  }

  const appDataRaw = typeof settings.arma3_appdata_path === 'string' ? settings.arma3_appdata_path.trim() : '';
  if (!appDataRaw) {
    return { error: 'Arma 3 appdata path is not configured.' };
  }
  const folder = path.resolve(expandEnvPath(appDataRaw));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    return { error: 'Arma 3 appdata folder was not found.' };
  }
  return { folder };
}

export async function handleListRptFiles(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<ListRptResponse> {
  const body = (args ?? {}) as ListRptPayload;
  const locRaw = typeof body.location === 'string' ? body.location.trim().toLowerCase() : '';
  const location: 'profile' | 'tools' = locRaw === 'tools' ? 'tools' : 'profile';

  const settings = JSON.parse(fs.readFileSync(ctx.settingsFile, 'utf8')) as Record<string, unknown>;
  const folderRow = resolveRptFolder(settings, location);
  if (!folderRow.folder) {
    return { error: folderRow.error ?? 'Log folder is not available.' };
  }

  const rpt_files: Array<{ name: string; path: string; size: number; modified_ts: number }> = [];
  try {
    for (const name of fs.readdirSync(folderRow.folder)) {
      if (!name.toLowerCase().endsWith('.rpt')) continue;
      const full = path.join(folderRow.folder, name);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      const stat = fs.statSync(full);
      rpt_files.push({
        name,
        path: full,
        size: stat.size,
        modified_ts: Math.floor(stat.mtimeMs / 1000),
      });
    }
  } catch (err) {
    return { error: `Could not list RPT files: ${err instanceof Error ? err.message : String(err)}` };
  }

  rpt_files.sort((a, b) => b.modified_ts - a.modified_ts);
  return { ok: true, folder: folderRow.folder, rpt_files, location };
}
