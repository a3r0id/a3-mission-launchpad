import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

export type HemttDiagnosticSeverity = 'error' | 'warning' | 'info' | 'help';

export type HemttDiagnostic = {
  severity: HemttDiagnosticSeverity;
  message: string;
  /** Absolute path when known */
  file?: string;
  line?: number;
  column?: number;
};

export type LintModProjectHemttPayload = {
  project_path?: unknown;
  projectPath?: unknown;
};

export type LintModProjectHemttResponse = {
  ok: boolean;
  exitCode?: number;
  diagnostics: HemttDiagnostic[];
  log?: string[];
  error?: string;
  code?: 'hemtt_missing' | 'hemtt_failed';
};

function readProjectPath(body: LintModProjectHemttPayload): string {
  const raw = body.project_path ?? body.projectPath;
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

function runHemttCheck(projectRoot: string, logLines: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('hemtt', ['check'], {
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

function normalizeSeverity(s: string): HemttDiagnosticSeverity {
  const x = s.toLowerCase();
  if (x === 'warning') return 'warning';
  if (x === 'help' || x === 'note') return 'help';
  return 'error';
}

/** Strip SGR color/control sequences (``hemtt check`` / rustc-style output is ANSI-colored on Windows). */
function stripAnsi(text: string): string {
  let s = text;
  for (let i = 0; i < 32; i += 1) {
    const next = s.replace(/\u001b\[[\d;?]*m/g, '').replace(/\u001b\][\s\S]*?\u0007/g, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

function resolveDiagnosticPath(projectRoot: string, rawPath: string): string {
  const t = rawPath.trim();
  if (!t) return path.join(projectRoot, 'unknown');
  if (path.isAbsolute(t)) return path.normalize(t);
  return path.normalize(path.join(projectRoot, t));
}

/** ``path:line:col: error|warning: message`` or ``path:line: error|warning:`` (no column). */
function parseGccStyleDiagnosticLine(projectRoot: string, line: string): HemttDiagnostic | null {
  const sevMatch = /:\s*(error|warning|note|help)\s*:\s*(.+)$/.exec(line);
  if (!sevMatch) return null;
  const prefix = line.slice(0, sevMatch.index);
  const two = /:(\d+):(\d+)$/.exec(prefix);
  if (two) {
    const filePart = prefix.slice(0, two.index);
    if (!filePart.trim()) return null;
    const ln = parseInt(two[1], 10);
    const col = parseInt(two[2], 10);
    return {
      severity: normalizeSeverity(sevMatch[1]),
      message: sevMatch[2].trim(),
      file: resolveDiagnosticPath(projectRoot, filePart.trim()),
      line: Number.isFinite(ln) ? ln : undefined,
      column: Number.isFinite(col) ? col : undefined,
    };
  }
  const one = /:(\d+)$/.exec(prefix);
  if (!one) return null;
  const filePart = prefix.slice(0, one.index);
  if (!filePart.trim()) return null;
  const ln = parseInt(one[1], 10);
  return {
    severity: normalizeSeverity(sevMatch[1]),
    message: sevMatch[2].trim(),
    file: resolveDiagnosticPath(projectRoot, filePart.trim()),
    line: Number.isFinite(ln) ? ln : undefined,
  };
}

/**
 * Parse ``hemtt check`` output (Rust-style diagnostics and common single-line forms).
 * @see https://hemtt.dev/commands/check.html
 */
export function parseHemttCheckOutput(projectRoot: string, lines: string[]): HemttDiagnostic[] {
  const diagnostics: HemttDiagnostic[] = [];
  const max = 400;
  let pendingMessage: string | null = null;
  let pendingSeverity: HemttDiagnosticSeverity = 'error';

  const flushPending = (file?: string, line?: number, column?: number) => {
    if (!pendingMessage?.trim()) return;
    diagnostics.push({
      severity: pendingSeverity,
      message: pendingMessage.trim(),
      file,
      line,
      column,
    });
    pendingMessage = null;
    pendingSeverity = 'error';
  };

  for (const raw of lines) {
    if (diagnostics.length >= max) break;
    const line = stripAnsi(raw.replace(/\r$/, ''));

    const cargoHead = /^(error|warning|help|note)(\[[^\]]+\])?:\s*(.*)$/.exec(line.trimStart());
    if (cargoHead) {
      flushPending();
      pendingSeverity = normalizeSeverity(cargoHead[1]);
      pendingMessage = cargoHead[3] ?? '';
      continue;
    }

    /** Rust ``-->`` or HEMTT box-drawing ``┌─`` location line. */
    const arrowTail =
      /^\s*-->\s*(.+):(\d+):(\d+)\s*$/.exec(line) ??
      /^\s*┌─\s*(.+):(\d+):(\d+)\s*$/.exec(line) ??
      /^\s*└─\s*(.+):(\d+):(\d+)\s*$/.exec(line);
    if (arrowTail && pendingMessage != null && pendingMessage.trim().length > 0) {
      const file = resolveDiagnosticPath(projectRoot, arrowTail[1].trim());
      const ln = parseInt(arrowTail[2], 10);
      const col = parseInt(arrowTail[3], 10);
      flushPending(file, Number.isFinite(ln) ? ln : undefined, Number.isFinite(col) ? col : undefined);
      continue;
    }

    const single = parseGccStyleDiagnosticLine(projectRoot, line);
    if (single) {
      flushPending();
      diagnostics.push(single);
      pendingMessage = null;
      continue;
    }
  }
  flushPending();

  return diagnostics;
}

/**
 * Runs ``hemtt check`` in the mod project root (read-only checks; see HEMTT Book).
 */
export async function handleLintHEMTTProject(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
): Promise<LintModProjectHemttResponse> {
  const body = (args ?? {}) as LintModProjectHemttPayload;
  const projectRaw = readProjectPath(body);
  if (!projectRaw) {
    return { ok: false, diagnostics: [], error: 'Missing or invalid project path.' };
  }

  const projectResolved = path.resolve(projectRaw);
  if (!fs.existsSync(projectResolved) || !fs.statSync(projectResolved).isDirectory()) {
    return { ok: false, diagnostics: [], error: 'Project path not found or not a directory.' };
  }

  const logLines: string[] = [];
  let exitCode = 1;
  try {
    exitCode = await runHemttCheck(projectResolved, logLines);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'HEMTT') {
      return {
        ok: false,
        code: 'hemtt_missing',
        diagnostics: [],
        log: logLines,
        error: 'HEMTT is not installed or not on PATH (`hemtt` command not found).',
      };
    }
    return {
      ok: false,
      code: 'hemtt_failed',
      diagnostics: [],
      log: logLines,
      error: `Could not start HEMTT: ${msg}`,
    };
  }

  const diagnostics = parseHemttCheckOutput(projectResolved, logLines);
  return {
    ok: exitCode === 0,
    exitCode,
    diagnostics,
    log: logLines,
  };
}
