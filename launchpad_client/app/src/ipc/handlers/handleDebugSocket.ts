import Launchpad from '../../Launchpad';
import { DEBUG_SOCKET_DEFAULT_HOST, DEBUG_SOCKET_DEFAULT_PORT, type DebugCommand } from '../../debug/types';

type StartArgs = {
  host?: unknown;
  port?: unknown;
};

type SendArgs = {
  command?: unknown;
};

export async function handleDebugServerStart(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: StartArgs | undefined,
) {
  const host = typeof args?.host === 'string' && args.host.trim() ? args.host.trim() : DEBUG_SOCKET_DEFAULT_HOST;
  const portRaw = Number(args?.port);
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : DEBUG_SOCKET_DEFAULT_PORT;
  try {
    const state = await ctx.debugSocket.start(host, port);
    return { ok: true, state };
  } catch (err) {
    return {
      ok: false,
      error: `Could not start debug server: ${err instanceof Error ? err.message : String(err)}`,
      state: ctx.debugSocket.getState(),
    };
  }
}

export async function handleDebugServerStop(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
) {
  try {
    const state = await ctx.debugSocket.stop();
    return { ok: true, state };
  } catch (err) {
    return {
      ok: false,
      error: `Could not stop debug server: ${err instanceof Error ? err.message : String(err)}`,
      state: ctx.debugSocket.getState(),
    };
  }
}

export async function handleDebugServerStatus(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
) {
  return { ok: true, state: ctx.debugSocket.getState() };
}

export async function handleDebugCommandSend(
  ctx: Launchpad,
  _event: Electron.IpcMainInvokeEvent,
  args: SendArgs | undefined,
) {
  const command = args?.command as DebugCommand | undefined;
  if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.type !== 'string') {
    return { ok: false, error: 'command.type is required.' };
  }
  try {
    const state = ctx.debugSocket.sendCommand(command);
    return { ok: true, state };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      state: ctx.debugSocket.getState(),
    };
  }
}
