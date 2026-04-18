import fs from 'node:fs';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import Launchpad from '../../Launchpad';
import { parseP3DBuffer } from '../../drivers/p3d';
import { buildPreviewMeshFromMlod } from '../../drivers/p3dMesh';
import { buildPreviewMeshFromOdol } from '../../drivers/p3dOdolMesh';

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

function readFourCC(buf: Uint8Array, o: number): string {
  if (o + 4 > buf.length) return '';
  return String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
}

/**
 * Return triangle mesh buffers for a ``.p3d`` preview (MLOD or ODOL).
 */
export function handleGetP3dPreviewMesh(
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

  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = readFourCC(u8, 0);

  let meshResult;
  if (magic === 'ODOL') {
    meshResult = buildPreviewMeshFromOdol(u8);
  } else {
    try {
      const p3d = parseP3DBuffer(u8);
      meshResult = buildPreviewMeshFromMlod(p3d);
    } catch {
      meshResult = { ok: false as const, error: 'This model could not be previewed.' };
    }
  }

  if (meshResult.ok !== true) {
    return {
      ok: false,
      error:
        typeof meshResult.error === 'string' && meshResult.error.trim()
          ? meshResult.error.trim()
          : 'This model could not be previewed.',
    };
  }

  const m = meshResult.mesh;
  const out: Record<string, unknown> = {
    ok: true,
    lodIndex: m.lodIndex,
    vertexCount: m.vertexCount,
    triangleCount: m.triangleCount,
    positions: Buffer.from(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength),
    indices: Buffer.from(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength),
    normals: Buffer.from(m.normals.buffer, m.normals.byteOffset, m.normals.byteLength),
    textureNames: m.textureNames,
  };
  if (m.primaryTexture) {
    out.primaryTexture = m.primaryTexture;
  }
  if (m.uvs && m.uvs.byteLength === m.vertexCount * 8) {
    out.uvs = Buffer.from(m.uvs.buffer, m.uvs.byteOffset, m.uvs.byteLength);
  }
  return out;
}
