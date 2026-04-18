import net, { type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  DEBUG_SOCKET_DEFAULT_HOST,
  DEBUG_SOCKET_DEFAULT_PORT,
  DEBUG_SOCKET_MAX_FRAME_BYTES,
  type DebugCommand,
  type DebugEvent,
  type DebugServerState,
} from './types';

type DebugListeners = {
  state: (state: DebugServerState) => void;
  event: (event: DebugEvent) => void;
};

function nowSec(): number {
  return Date.now() / 1000;
}

export class DebugSocketService {
  private server: Server | null = null;
  private socket: Socket | null = null;
  private readBuffer: Buffer = Buffer.alloc(0);
  private state: DebugServerState = {
    host: DEBUG_SOCKET_DEFAULT_HOST,
    port: DEBUG_SOCKET_DEFAULT_PORT,
    listening: false,
    connected: false,
    clientAddress: null,
    messagesSent: 0,
    messagesReceived: 0,
    lastError: null,
  };
  private listeners: DebugListeners = {
    state: () => {},
    event: () => {},
  };

  setListeners(listeners: Partial<DebugListeners>) {
    this.listeners = {
      ...this.listeners,
      ...listeners,
    };
  }

  getState(): DebugServerState {
    return { ...this.state };
  }

  async start(host = DEBUG_SOCKET_DEFAULT_HOST, port = DEBUG_SOCKET_DEFAULT_PORT): Promise<DebugServerState> {
    if (this.server && this.state.listening) {
      return this.getState();
    }
    this.state.host = host;
    this.state.port = port;
    this.state.lastError = null;

    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer((socket) => this.attachSocket(socket));
      this.server = srv;
      srv.on('error', (err) => {
        this.state.lastError = `Socket server error: ${err.message}`;
        this.emitState();
        this.emitSystemEvent('server.error', { message: err.message }, 'error');
      });
      srv.listen(port, host, () => {
        this.state.listening = true;
        this.emitState();
        this.emitSystemEvent('server.started', { host, port });
        resolve();
      });
      srv.once('error', reject);
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.lastError = `Failed to start debug server: ${msg}`;
      this.emitState();
      this.emitSystemEvent('server.startFailed', { message: msg }, 'error');
      throw err;
    });
    return this.getState();
  }

  async stop(): Promise<DebugServerState> {
    this.detachSocket();
    if (!this.server) {
      this.state.listening = false;
      this.emitState();
      return this.getState();
    }
    const srv = this.server;
    this.server = null;
    await new Promise<void>((resolve) => {
      try {
        srv.close(() => resolve());
      } catch {
        resolve();
      }
    });
    this.state.listening = false;
    this.emitState();
    this.emitSystemEvent('server.stopped');
    return this.getState();
  }

  sendCommand(command: DebugCommand): DebugServerState {
    if (!this.socket || !this.state.connected) {
      throw new Error('Debug socket is not connected.');
    }
    const envelope: DebugCommand = {
      id: command.id ?? randomUUID().replaceAll('-', ''),
      ts: command.ts ?? nowSec(),
      type: command.type ?? 'custom',
      payload: command.payload ?? {},
    };
    const payload = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (payload.length <= 0 || payload.length > DEBUG_SOCKET_MAX_FRAME_BYTES) {
      throw new Error('Debug command payload exceeds frame size limit.');
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
    this.state.messagesSent += 1;
    this.emitState();
    this.emitDebugEvent({
      id: envelope.id ?? randomUUID().replaceAll('-', ''),
      ts: envelope.ts ?? nowSec(),
      direction: 'outbound',
      type: envelope.type,
      payload: envelope.payload,
      raw: envelope,
      level: 'info',
    });
    return this.getState();
  }

  private attachSocket(socket: Socket) {
    this.detachSocket();
    this.socket = socket;
    this.readBuffer = Buffer.alloc(0);
    this.state.connected = true;
    this.state.clientAddress = socket.remoteAddress ?? null;
    this.state.lastError = null;
    this.emitState();
    this.emitSystemEvent('client.connected', {
      address: socket.remoteAddress ?? '',
      port: socket.remotePort ?? null,
    });

    socket.on('data', (chunk) => this.onSocketData(chunk));
    socket.on('close', () => {
      this.state.connected = false;
      this.state.clientAddress = null;
      this.emitState();
      this.emitSystemEvent('client.disconnected');
      this.socket = null;
      this.readBuffer = Buffer.alloc(0);
    });
    socket.on('error', (err) => {
      this.state.lastError = `Socket connection error: ${err.message}`;
      this.emitState();
      this.emitSystemEvent('client.error', { message: err.message }, 'error');
    });
  }

  private detachSocket() {
    if (!this.socket) return;
    try {
      this.socket.destroy();
    } catch {
      // ignore
    }
    this.socket = null;
    this.readBuffer = Buffer.alloc(0);
    this.state.connected = false;
    this.state.clientAddress = null;
    this.emitState();
  }

  private onSocketData(chunk: Buffer) {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    while (this.readBuffer.length >= 4) {
      const frameLen = this.readBuffer.readUInt32BE(0);
      if (frameLen <= 0 || frameLen > DEBUG_SOCKET_MAX_FRAME_BYTES) {
        this.state.lastError = `Invalid frame length (${frameLen}).`;
        this.emitState();
        this.emitSystemEvent('frame.invalidLength', { frameLen }, 'error');
        this.detachSocket();
        return;
      }
      if (this.readBuffer.length < 4 + frameLen) {
        return;
      }
      const frame = this.readBuffer.subarray(4, 4 + frameLen);
      this.readBuffer = this.readBuffer.subarray(4 + frameLen);
      this.handleInboundFrame(frame);
    }
  }

  private handleInboundFrame(frame: Buffer) {
    this.state.messagesReceived += 1;
    this.emitState();
    const text = frame.toString('utf8');
    let parsed: unknown = text;
    let type = 'inbound.raw';
    let payload: unknown = text;
    let id = randomUUID().replaceAll('-', '');
    try {
      parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const row = parsed as Record<string, unknown>;
        if (typeof row.type === 'string' && row.type.trim()) {
          type = row.type;
        } else {
          type = 'inbound.json';
        }
        if (typeof row.id === 'string' && row.id.trim()) {
          id = row.id.trim();
        }
        payload = row.payload ?? row;
      }
    } catch {
      // keep raw fallback
    }

    this.emitDebugEvent({
      id,
      ts: nowSec(),
      direction: 'inbound',
      type,
      payload,
      raw: parsed,
      level: 'info',
    });
  }

  private emitState() {
    this.listeners.state(this.getState());
  }

  private emitDebugEvent(event: DebugEvent) {
    this.listeners.event(event);
  }

  private emitSystemEvent(type: string, payload: unknown = undefined, level: 'info' | 'warn' | 'error' = 'info') {
    this.emitDebugEvent({
      id: randomUUID().replaceAll('-', ''),
      ts: nowSec(),
      direction: 'system',
      type,
      payload,
      raw: payload,
      level,
    });
  }
}
