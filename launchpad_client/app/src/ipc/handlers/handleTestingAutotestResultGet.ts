import fs from 'node:fs';
import path from 'node:path';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

const AUTOTEST_SCAN_MAX_FILES = 8;
const AUTOTEST_SCAN_MAX_BYTES_PER_FILE = 1_000_000;
const AUTOTEST_CARRY_MAX = 8192;
const AUTOTEST_BLOCK_RE = /<AutoTest\s+result="([^"]+)"\s*>([\s\S]*?)<\/AutoTest>/gi;

function parseAutotestFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export async function handleTestingAutotestResultGet(
  ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: { watch_id?: string } | undefined,
) {
  const requested = typeof args?.watch_id === 'string' ? args.watch_id.trim() : '';
  const watch = ctx.autotestWatch;
  if (!watch) return { ok: true, active: false, complete: false, reason: 'no_watch' };
  if (requested && requested !== watch.watch_id) {
    return { ok: true, active: false, complete: false, reason: 'stale_watch' };
  }
  if (watch.result && typeof watch.result === 'object') {
    return {
      ok: true,
      active: false,
      complete: true,
      watch_id: watch.watch_id,
      started_ts: watch.started_ts,
      result_data: watch.result,
    };
  }

  const appdata = typeof watch.appdata === 'string' ? watch.appdata.trim() : '';
  if (!appdata || !fs.existsSync(appdata) || !fs.statSync(appdata).isDirectory()) {
    return { error: 'Arma 3 appdata path is not configured or no longer exists.' };
  }

  const rptFiles: Array<{ path: string; modified_ts: number; size: number }> = [];
  try {
    for (const name of fs.readdirSync(appdata)) {
      if (!name.toLowerCase().endsWith('.rpt')) continue;
      const full = path.join(appdata, name);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
      rptFiles.push({ path: full, modified_ts: fs.statSync(full).mtimeMs / 1000, size: fs.statSync(full).size });
    }
  } catch (err) {
    return { error: `Could not inspect RPT files: ${err instanceof Error ? err.message : String(err)}` };
  }
  rptFiles.sort((a, b) => b.modified_ts - a.modified_ts);

  for (const row of rptFiles.slice(0, AUTOTEST_SCAN_MAX_FILES)) {
    const filePath = row.path;
    const fileSize = row.size;
    let prevOffset = watch.offsets[filePath] ?? 0;
    if (!(filePath in watch.offsets)) {
      prevOffset = Math.max(0, fileSize - AUTOTEST_SCAN_MAX_BYTES_PER_FILE);
    }
    let readStart = Math.max(0, Math.min(prevOffset, fileSize));
    if (fileSize - readStart > AUTOTEST_SCAN_MAX_BYTES_PER_FILE) {
      readStart = fileSize - AUTOTEST_SCAN_MAX_BYTES_PER_FILE;
    }
    if (fileSize <= readStart) {
      watch.offsets[filePath] = fileSize;
      continue;
    }
    let chunk = '';
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const len = fileSize - readStart;
        const buf = Buffer.allocUnsafe(len);
        fs.readSync(fd, buf, 0, len, readStart);
        chunk = (watch.carry[filePath] ?? '') + buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      watch.offsets[filePath] = fileSize;
      continue;
    }

    let lastMatch: RegExpExecArray | null = null;
    AUTOTEST_BLOCK_RE.lastIndex = 0;
    for (;;) {
      const m = AUTOTEST_BLOCK_RE.exec(chunk);
      if (!m) break;
      lastMatch = m;
    }
    if (lastMatch) {
      const resultText = (lastMatch[1] ?? '').trim();
      const body = lastMatch[2] ?? '';
      const fields = parseAutotestFields(body);
      watch.result = {
        result: resultText,
        fields,
        end_mode: fields.EndMode ?? fields.endmode ?? '',
        mission: fields.Mission ?? fields.mission ?? '',
        detected_ts: Date.now() / 1000,
        rpt_path: filePath,
        raw_block: lastMatch[0],
      };
      watch.offsets[filePath] = fileSize;
      watch.carry[filePath] = chunk.slice(-AUTOTEST_CARRY_MAX);
      return {
        ok: true,
        active: false,
        complete: true,
        watch_id: watch.watch_id,
        started_ts: watch.started_ts,
        result_data: watch.result,
      };
    }

    watch.offsets[filePath] = fileSize;
    watch.carry[filePath] = chunk.slice(-AUTOTEST_CARRY_MAX);
  }

  watch.poll_count = (watch.poll_count ?? 0) + 1;
  return {
    ok: true,
    active: true,
    complete: false,
    watch_id: watch.watch_id,
    started_ts: watch.started_ts,
    poll_count: watch.poll_count,
  };
}
