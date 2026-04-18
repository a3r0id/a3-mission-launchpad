import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';
import { ensureHemttProjectScaffold, isHemttProjectRoot } from './handleInitHEMTTProject';

/** IPC body mirrors mission PBO build where it makes sense (paths, optional copy target, overwrite). */
export type BuildModProjectHemttPayload = {
  project_path?: unknown;
  projectPath?: unknown;
  output_path?: unknown;
  outputPath?: unknown;
  overwrite?: unknown;
};

export type BuildModProjectHemttResponse = {
  ok: boolean;
  /** Newest built addon PBO (HEMTT ``.hemttout`` / ``releases``), or copy destination when ``output_path`` is set. */
  pboPath?: string;
  /** All ``.pbo`` files discovered under known HEMTT output folders after a successful build. */
  pboPaths?: string[];
  log?: string[];
  error?: string;
  code?: 'pbo_exists' | 'hemtt_missing' | 'no_pbo_output' | 'hemtt_failed';
};

function readStringField(
  body: BuildModProjectHemttPayload,
  snake: keyof BuildModProjectHemttPayload,
  camel: keyof BuildModProjectHemttPayload,
): string {
  const raw = body[snake] ?? body[camel];
  return typeof raw === 'string' ? raw.trim() : '';
}

function appendProcessText(chunk: Buffer, carry: string, onLine: (line: string) => void): string {
  let buf = carry + chunk.toString('utf8');
  const parts = buf.split(/\r?\n/);
  const rest = parts.pop() ?? '';
  for (const line of parts) {
    if (line.length) onLine(line);
  }
  return rest;
}

function runHemttBuild(projectRoot: string, logLines: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('hemtt', ['build'], {
      cwd: projectRoot,
      windowsHide: true,
    });
    let outCarry = '';
    let errCarry = '';
    child.stdout?.on('data', (ch: Buffer) => {
      outCarry = appendProcessText(ch, outCarry, (line) => logLines.push(line));
    });
    child.stderr?.on('data', (ch: Buffer) => {
      errCarry = appendProcessText(ch, errCarry, (line) => logLines.push(line));
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err?.code === 'ENOENT') {
        reject(new Error('HEMTT'));
        return;
      }
      reject(err);
    });
    child.on('close', (code) => {
      if (outCarry.trim()) logLines.push(outCarry.trim());
      if (errCarry.trim()) logLines.push(errCarry.trim());
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

type PboHit = { abs: string; mtime: number };

function pushPboDir(dir: string, out: PboHit[]): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.pbo')) continue;
    const abs = path.join(dir, name);
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) out.push({ abs, mtime: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
}

/** Collect addon PBOs from typical HEMTT 1.x output locations. */
function collectHemttOutputPbos(projectRoot: string): PboHit[] {
  const hits: PboHit[] = [];
  pushPboDir(path.join(projectRoot, '.hemttout', 'build', 'addons'), hits);
  const releases = path.join(projectRoot, 'releases');
  if (fs.existsSync(releases) && fs.statSync(releases).isDirectory()) {
    for (const ver of fs.readdirSync(releases)) {
      pushPboDir(path.join(releases, ver, 'addons'), hits);
    }
  }
  return hits;
}

function pickNewestPbo(hits: PboHit[]): string | null {
  if (!hits.length) return null;
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0].abs;
}

function resolveCopyDestination(projectRoot: string, outputPathRaw: string, sourcePbo: string): string {
  if (!outputPathRaw) return sourcePbo;
  const out = path.resolve(outputPathRaw);
  if (out.toLowerCase().endsWith('.pbo')) {
    return out;
  }
  if (fs.existsSync(out) && fs.statSync(out).isDirectory()) {
    return path.join(out, path.basename(sourcePbo));
  }
  return path.join(out, path.basename(sourcePbo));
}

/**
 * Runs ``hemtt build`` in the mod project root and returns logs plus discovered output PBO paths.
 * Optional ``output_path`` copies the newest built addon PBO to a file or folder (same semantics as mission build).
 */
export async function handleBuildHEMTTProject(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<BuildModProjectHemttResponse> {
  const body = (args ?? {}) as BuildModProjectHemttPayload;
  const projectRaw = readStringField(body, 'project_path', 'projectPath');
  if (!projectRaw) {
    return { ok: false, error: 'Missing or invalid project path.' };
  }

  const projectResolved = path.resolve(projectRaw);
  if (!fs.existsSync(projectResolved) || !fs.statSync(projectResolved).isDirectory()) {
    return { ok: false, error: 'Project path not found or not a directory.' };
  }

  const logLines: string[] = [];

  if (!isHemttProjectRoot(projectResolved)) {
    const scaffold = ensureHemttProjectScaffold(projectResolved, {
      displayName: path.basename(projectResolved),
    });
    for (const line of scaffold.log ?? []) {
      logLines.push(line);
    }
    if (!scaffold.ok) {
      return {
        ok: false,
        code: 'hemtt_failed',
        log: logLines,
        error:
          scaffold.error ??
          'Could not create a HEMTT project layout in this folder before building.',
      };
    }
  }

  let exitCode = 1;
  try {
    exitCode = await runHemttBuild(projectResolved, logLines);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'HEMTT') {
      return {
        ok: false,
        code: 'hemtt_missing',
        log: logLines,
        error: 'HEMTT is not installed or not on PATH (`hemtt` command not found).',
      };
    }
    return {
      ok: false,
      code: 'hemtt_failed',
      log: logLines,
      error: `Could not start HEMTT: ${msg}`,
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      code: 'hemtt_failed',
      log: logLines,
      error: `hemtt build exited with code ${exitCode}.`,
    };
  }

  const hits = collectHemttOutputPbos(projectResolved);
  const pboPaths = hits.map((h) => h.abs).sort((a, b) => a.localeCompare(b));
  const primary = pickNewestPbo(hits);
  if (!primary) {
    return {
      ok: false,
      code: 'no_pbo_output',
      log: logLines,
      error: 'Build finished but no .pbo files were found under .hemttout/build/addons or releases/*/addons.',
    };
  }

  const outputPathRaw = readStringField(body, 'output_path', 'outputPath');
  const overwrite = body.overwrite === true;
  let reportedPath = primary;

  if (outputPathRaw) {
    const dest = resolveCopyDestination(projectResolved, outputPathRaw, primary);
    if (fs.existsSync(dest) && fs.statSync(dest).isFile()) {
      if (!overwrite) {
        return {
          ok: false,
          code: 'pbo_exists',
          error: 'A PBO file already exists at the output path.',
          pboPath: dest,
          pboPaths,
          log: logLines,
        };
      }
      try {
        fs.unlinkSync(dest);
      } catch (err) {
        return {
          ok: false,
          log: logLines,
          error: `Could not remove existing PBO: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(primary, dest);
      reportedPath = dest;
    } catch (err) {
      return {
        ok: false,
        log: logLines,
        error: `Could not copy PBO to output path: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { ok: true, pboPath: reportedPath, pboPaths, log: logLines };
}
