export const DEBUG_SOCKET_DEFAULT_HOST = '127.0.0.1';
export const DEBUG_SOCKET_DEFAULT_PORT = 8112;
export const DEBUG_SOCKET_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type DebugCommandType =
  | 'ping'
  | 'sqf.run'
  | 'sqf.eval'
  | 'mission.event'
  | 'extension.call'
  | 'custom';

export type DebugCommand = {
  id?: string;
  ts?: number;
  type: DebugCommandType | string;
  payload?: Record<string, unknown>;
};

export type DebugServerState = {
  host: string;
  port: number;
  listening: boolean;
  connected: boolean;
  clientAddress: string | null;
  messagesSent: number;
  messagesReceived: number;
  lastError: string | null;
};

export type DebugEvent = {
  id: string;
  ts: number;
  direction: 'inbound' | 'outbound' | 'system';
  type: string;
  payload?: unknown;
  raw?: unknown;
  level?: 'info' | 'warn' | 'error';
};
