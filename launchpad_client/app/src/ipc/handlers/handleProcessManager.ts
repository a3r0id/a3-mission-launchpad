import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';

const execFileAsync = promisify(execFile);

type ProcessRow = {
  pid: number;
  name: string;
  exe: string | null;
  cmdline: string[] | null;
  username: string | null;
  create_time: number | null;
  cpu_percent: number;
  memory_rss: number;
  memory_vms: number;
  memory_percent: number;
  num_threads: number;
  num_handles: number | null;
  io_read_bytes: number | null;
  io_write_bytes: number | null;
  children: number[];
};

function isArmaProcessName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.includes('arma3') || n === 'arma3server_x64.exe' || n === 'arma3server.exe';
}

function splitCommandLine(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cmd)) !== null) {
    const raw = match[1] ?? match[2] ?? match[0];
    const token = raw.replace(/\\(["'\\])/g, '$1').trim();
    if (token) out.push(token);
  }
  return out;
}

async function windowsProcessSnapshot(): Promise<ProcessRow[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$totalMem = (Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize
$perfByPid = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object {
  if ($_.IDProcess -gt 0 -and $null -ne $_.PercentProcessorTime) {
    $perfByPid[[int]$_.IDProcess] = [double]$_.PercentProcessorTime
  }
}
$items = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match 'arma3' -or $_.Name -in @('arma3server_x64.exe','arma3server.exe')
}
$rows = @()
foreach ($p in $items) {
  $ownerObj = $p.GetOwner()
  $owner = $null
  if ($ownerObj -and $ownerObj.ReturnValue -eq 0) {
    $owner = "$($ownerObj.Domain)\\$($ownerObj.User)"
  }
  $children = @($items | Where-Object { $_.ParentProcessId -eq $p.ProcessId } | ForEach-Object { [int]$_.ProcessId })
  $cmd = if ($p.CommandLine) { [string]$p.CommandLine } else { '' }
  $rssBytes = [int64]$p.WorkingSetSize
  $cpuPct = if ($perfByPid.ContainsKey([int]$p.ProcessId)) { [double]$perfByPid[[int]$p.ProcessId] } else { 0.0 }
  $memPct = if ($totalMem -and [double]$totalMem -gt 0) {
    [double](($rssBytes / 1024.0) * 100.0 / [double]$totalMem)
  } else {
    0.0
  }
  $rows += [PSCustomObject]@{
    pid = [int]$p.ProcessId
    name = [string]$p.Name
    exe = if ($p.ExecutablePath) { [string]$p.ExecutablePath } else { $null }
    cmdline = if ($cmd) { @($cmd -split '\\s+') } else { $null }
    username = if ($owner) { [string]$owner } else { $null }
    create_time = $null
    cpu_percent = $cpuPct
    memory_rss = $rssBytes
    memory_vms = [int64]$p.VirtualSize
    memory_percent = $memPct
    num_threads = [int]$p.ThreadCount
    num_handles = [int]$p.HandleCount
    io_read_bytes = if ($null -ne $p.ReadTransferCount) { [int64]$p.ReadTransferCount } else { $null }
    io_write_bytes = if ($null -ne $p.WriteTransferCount) { [int64]$p.WriteTransferCount } else { $null }
    children = $children
  }
}
$rows | ConvertTo-Json -Depth 5 -Compress
`.trim();

  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
  const parsed = JSON.parse((stdout || '[]').trim() || '[]') as Record<string, unknown>[] | Record<string, unknown>;
  const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  return rows
    .map((r): ProcessRow | null => {
      const pid = Number(r.pid);
      const name = typeof r.name === 'string' ? r.name : '';
      if (!Number.isFinite(pid) || pid <= 0 || !name) return null;
      return {
        pid,
        name,
        exe: typeof r.exe === 'string' ? r.exe : null,
        cmdline: Array.isArray(r.cmdline) ? r.cmdline.filter((x): x is string => typeof x === 'string') : null,
        username: typeof r.username === 'string' ? r.username : null,
        create_time: typeof r.create_time === 'number' ? r.create_time : null,
        cpu_percent: typeof r.cpu_percent === 'number' ? r.cpu_percent : 0,
        memory_rss: typeof r.memory_rss === 'number' ? r.memory_rss : 0,
        memory_vms: typeof r.memory_vms === 'number' ? r.memory_vms : 0,
        memory_percent: typeof r.memory_percent === 'number' ? r.memory_percent : 0,
        num_threads: typeof r.num_threads === 'number' ? r.num_threads : 0,
        num_handles: typeof r.num_handles === 'number' ? r.num_handles : null,
        io_read_bytes: typeof r.io_read_bytes === 'number' ? r.io_read_bytes : null,
        io_write_bytes: typeof r.io_write_bytes === 'number' ? r.io_write_bytes : null,
        children: Array.isArray(r.children)
          ? r.children.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
          : [],
      };
    })
    .filter((row): row is ProcessRow => row !== null)
    .sort((a, b) => a.pid - b.pid);
}

async function unixProcessSnapshot(): Promise<ProcessRow[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,pcpu=,rss=,comm=,args='], {});
  const rows: ProcessRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cpuPercent = Number(m[2]);
    const rssKb = Number(m[3]);
    const name = m[4];
    if (!Number.isFinite(pid) || pid <= 0 || !isArmaProcessName(name)) continue;
    const args = (m[5] || '').trim();
    rows.push({
      pid,
      name,
      exe: null,
      cmdline: args ? splitCommandLine(args) : null,
      username: null,
      create_time: null,
      cpu_percent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
      memory_rss: Number.isFinite(rssKb) ? rssKb * 1024 : 0,
      memory_vms: 0,
      memory_percent: 0,
      num_threads: 0,
      num_handles: null,
      io_read_bytes: null,
      io_write_bytes: null,
      children: [],
    });
  }
  rows.sort((a, b) => a.pid - b.pid);
  return rows;
}

export async function handleProcessManagerGet(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
) {
  try {
    const processes = process.platform === 'win32' ? await windowsProcessSnapshot() : await unixProcessSnapshot();
    return { ok: true, processes, sampled_at_ms: Date.now() };
  } catch (err) {
    return { error: `Could not read process snapshot: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function getProcessNameByPid(pid: number): Promise<string> {
  if (process.platform === 'win32') {
    const script = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").Name`;
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    return stdout.trim();
  }
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], {});
  return stdout.trim();
}

export async function handleProcessManagerKillPost(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  args: { pid?: unknown } | undefined,
) {
  const pid = Number(args?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return { error: 'Invalid process id.' };
  }
  try {
    const name = await getProcessNameByPid(pid);
    if (!name) {
      return { error: 'That session is already closed.' };
    }
    if (!isArmaProcessName(name)) {
      return { error: 'Only sessions listed here can be stopped this way.' };
    }
    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return { ok: true, stopped: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('no such process')) {
      return { ok: true, stopped: true, gone: true };
    }
    return { error: 'Not allowed to stop this session.' };
  }
}
