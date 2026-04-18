import { randomUUID } from 'node:crypto';
import { IpcMainInvokeEvent } from 'electron';
import { NodeSSH } from 'node-ssh';
import Launchpad from '../../Launchpad';

type SshAuthKind = 'password' | 'key';

type SshSessionOpenPayload = {
  name?: unknown;
  host?: unknown;
  port?: unknown;
  username?: unknown;
  auth?: unknown;
  keyPath?: unknown;
  password?: unknown;
  passphrase?: unknown;
};

type SshSessionClosePayload = {
  session_id?: unknown;
  sessionId?: unknown;
};

type SshRptListPayload = SshSessionClosePayload & {
  folder?: unknown;
};

type SshRptTailPayload = SshSessionClosePayload & {
  path?: unknown;
  start?: unknown;
  end?: unknown;
};

type SessionRow = {
  id: string;
  ssh: NodeSSH;
  connectedAt: number;
  host: string;
  port: number;
  username: string;
};

const sshSessions = new Map<string, SessionRow>();

function readString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function readSessionId(body: SshSessionClosePayload): string {
  return readString(body.session_id ?? body.sessionId);
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sessionById(id: string): SessionRow {
  const row = sshSessions.get(id);
  if (!row) throw new Error('SSH session not found.');
  return row;
}

async function sshExec(ssh: NodeSSH, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const res = await ssh.execCommand(command);
  return {
    code: typeof res.code === 'number' ? res.code : 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

async function sshReadFileSize(ssh: NodeSSH, remotePath: string): Promise<number> {
  const qPath = shellQuoteSingle(remotePath);
  const cmd = `wc -c < ${qPath}`;
  const res = await sshExec(ssh, cmd);
  if (res.code !== 0) {
    throw new Error((res.stderr || 'Could not read remote file size.').trim());
  }
  const n = Number.parseInt(res.stdout.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Remote file size is invalid.');
  }
  return n;
}

async function sshReadFileSliceBase64(ssh: NodeSSH, remotePath: string, start: number, end?: number): Promise<string> {
  const qPath = shellQuoteSingle(remotePath);
  const safeStart = Math.max(0, Math.floor(start));
  const hasEnd = Number.isFinite(end);
  const safeEnd = hasEnd ? Math.max(safeStart, Math.floor(end as number)) : undefined;
  const cmd = safeEnd == null
    ? `tail -c +$(( ${safeStart} + 1 )) ${qPath} 2>/dev/null | base64 | tr -d '\\n'`
    : `dd if=${qPath} bs=1 skip=${safeStart} count=$(( ${safeEnd} - ${safeStart} )) status=none 2>/dev/null | base64 | tr -d '\\n'`;
  const res = await sshExec(ssh, cmd);
  if (res.code !== 0) {
    throw new Error((res.stderr || 'Could not read remote file content.').trim());
  }
  return res.stdout.trim();
}

function decodeBase64Utf8(raw: string): string {
  if (!raw) return '';
  return Buffer.from(raw, 'base64').toString('utf8');
}

export async function handleSshSessionOpen(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
) {
  const body = (args ?? {}) as SshSessionOpenPayload;
  const host = readString(body.host);
  const username = readString(body.username);
  const authRaw = readString(body.auth).toLowerCase();
  const auth: SshAuthKind = authRaw === 'key' ? 'key' : 'password';
  const keyPath = readString(body.keyPath);
  const password = readString(body.password);
  const passphrase = readString(body.passphrase);
  const portRaw = Number.parseInt(String(body.port ?? 22), 10);
  const port = Number.isInteger(portRaw) && portRaw > 0 ? portRaw : 22;

  if (!host || !username) {
    return { ok: false, error: 'Host and username are required.' };
  }
  if (auth === 'key' && !keyPath) {
    return { ok: false, error: 'A key file path is required for key authentication.' };
  }
  if (auth === 'password' && !password) {
    return { ok: false, error: 'Password is required for password authentication.' };
  }

  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host,
      port,
      username,
      ...(auth === 'key'
        ? { privateKeyPath: keyPath, passphrase: passphrase || undefined }
        : { password }),
    });
  } catch (err) {
    try {
      ssh.dispose();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: `Could not connect to remote server: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const sessionId = randomUUID();
  sshSessions.set(sessionId, {
    id: sessionId,
    ssh,
    connectedAt: Date.now(),
    host,
    port,
    username,
  });
  return { ok: true, session_id: sessionId, sessionId, host, port, username };
}

export async function handleSshSessionClose(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
) {
  const body = (args ?? {}) as SshSessionClosePayload;
  const sessionId = readSessionId(body);
  if (!sessionId) return { ok: false, error: 'Missing session id.' };
  const row = sshSessions.get(sessionId);
  if (!row) return { ok: true, closed: true };
  try {
    row.ssh.dispose();
  } catch {
    /* ignore */
  }
  sshSessions.delete(sessionId);
  return { ok: true, closed: true };
}

export async function handleSshRptList(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
) {
  const body = (args ?? {}) as SshRptListPayload;
  const sessionId = readSessionId(body);
  const folder = readString(body.folder) || '/home/steam/arma3';
  if (!sessionId) return { ok: false, error: 'Missing session id.' };
  try {
    const row = sessionById(sessionId);
    const qFolder = shellQuoteSingle(folder);
    const cmd =
      `find ${qFolder} -maxdepth 1 -type f -name '*.rpt' -printf '%f\\t%s\\t%T@\\n' 2>/dev/null | sort -t$'\\t' -k3,3nr`;
    const res = await sshExec(row.ssh, cmd);
    if (res.code !== 0) {
      return { ok: false, error: (res.stderr || 'Could not list remote RPT files.').trim() };
    }
    const rpt_files: Array<{ name: string; path: string; size: number; modified_ts: number }> = [];
    const lines = res.stdout.split(/\r?\n/).filter((x) => x.trim().length > 0);
    for (const line of lines) {
      const [name, sizeRaw, mtimeRaw] = line.split('\t');
      const size = Number.parseInt((sizeRaw ?? '').trim(), 10);
      const modified = Math.floor(Number.parseFloat((mtimeRaw ?? '').trim()) || 0);
      if (!name) continue;
      rpt_files.push({
        name,
        path: `${folder.replace(/\/+$/g, '')}/${name}`,
        size: Number.isFinite(size) && size >= 0 ? size : 0,
        modified_ts: Number.isFinite(modified) && modified > 0 ? modified : 0,
      });
    }
    return { ok: true, folder, rpt_files, location: 'remote' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleSshRptTailInit(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
) {
  const body = (args ?? {}) as SshRptTailPayload;
  const sessionId = readSessionId(body);
  const remotePath = readString(body.path);
  const start = Number.isFinite(body.start) ? Number(body.start) : 0;
  if (!sessionId || !remotePath) {
    return { ok: false, error: 'Missing session id or file path.' };
  }
  try {
    const row = sessionById(sessionId);
    const fileSize = await sshReadFileSize(row.ssh, remotePath);
    const safeStart = Math.max(0, Math.min(Math.floor(start), fileSize));
    const encoded = await sshReadFileSliceBase64(row.ssh, remotePath, safeStart);
    const content = decodeBase64Utf8(encoded);
    const end = fileSize;
    return { ok: true, path: remotePath, content, start: safeStart, end, file_size: fileSize };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleSshRptTailNext(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: unknown,
) {
  const body = (args ?? {}) as SshRptTailPayload;
  const sessionId = readSessionId(body);
  const remotePath = readString(body.path);
  const start = Number.isFinite(body.start) ? Number(body.start) : 0;
  if (!sessionId || !remotePath) {
    return { ok: false, error: 'Missing session id or file path.' };
  }
  try {
    const row = sessionById(sessionId);
    const fileSize = await sshReadFileSize(row.ssh, remotePath);
    const safeStart = Math.max(0, Math.min(Math.floor(start), fileSize));
    if (safeStart >= fileSize) {
      return { ok: true, path: remotePath, content: '', start: safeStart, end: fileSize, file_size: fileSize };
    }
    const encoded = await sshReadFileSliceBase64(row.ssh, remotePath, safeStart, fileSize);
    const content = decodeBase64Utf8(encoded);
    return { ok: true, path: remotePath, content, start: safeStart, end: fileSize, file_size: fileSize };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
