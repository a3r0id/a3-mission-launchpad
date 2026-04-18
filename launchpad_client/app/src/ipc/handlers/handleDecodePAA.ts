import fs from 'node:fs';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';
import { decodePaaFileBuffer } from '../../paa/decodePaaFile';

function pathArgFromInvokePayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload.trim();
  }
  if (payload && typeof payload === 'object' && 'path' in payload) {
    const p = (payload as { path: unknown }).path;
    if (typeof p === 'string' && p.trim()) {
      return p.trim();
    }
  }
  return '';
}

/**
 * Read a ``.paa`` file (DXT1 / DXT5), decode to RGBA8888, return bytes for canvas / WebGL in the renderer.
 */
export async function handleDecodePAA(
  _ctx: Launchpad,
  _event: IpcMainInvokeEvent,
  payload: unknown,
) {
  const pathRaw = pathArgFromInvokePayload(payload);
  if (!pathRaw) {
    return { ok: false, error: 'Missing path.' };
  }
  const resolved = path.resolve(pathRaw);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: 'File not found.' };
  }
  let buf: Buffer;
  try {
    buf = fs.readFileSync(resolved);
  } catch {
    return { ok: false, error: 'Could not read the file.' };
  }
  const decoded = decodePaaFileBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  if (decoded.ok === true) {
    return {
      ok: true,
      width: decoded.width,
      height: decoded.height,
      /** RGBA8888 row-major, length ``width * height * 4`` */
      data: Buffer.from(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength),
    };
  }
  return { ok: false, error: decoded.error };
}
