import { Odol } from '@bis-toolkit/p3d';
import type { PreviewMesh, PreviewMeshResult } from './p3dMesh';
import { armaVecToThree } from './p3dMesh';

type OdolVector = { x: number; y: number; z: number };

type OdolFace = { vertexIndices: number[] };

type OdolLodLike = {
  vertices: OdolVector[];
  faces: OdolFace[];
};

type OdolLike = {
  modelInfo: { centerOfMass: OdolVector } | null;
  lods: OdolLodLike[];
};

function pickOdolLodIndex(lods: OdolLodLike[]): number {
  if (!lods.length) return 0;
  let best = lods.length - 1;
  let bestN = lods[best]?.vertices?.length ?? 0;
  for (let i = lods.length - 1; i >= 0; i--) {
    const n = lods[i]?.vertices?.length ?? 0;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  return best;
}

function meshFromOdol(odol: OdolLike): PreviewMeshResult {
  const lodIdx = pickOdolLodIndex(odol.lods);
  const lod = odol.lods[lodIdx];
  if (!lod?.vertices?.length || !lod.faces?.length) {
    return { ok: false, error: 'This model could not be previewed.' };
  }

  const cog = odol.modelInfo?.centerOfMass ?? { x: 0, y: 0, z: 0 };
  const verts = lod.vertices;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const face of lod.faces) {
    const vidx = face.vertexIndices;
    if (vidx.length === 3) {
      const base = positions.length / 3;
      for (const vi of vidx) {
        const v = verts[vi];
        if (!v) return { ok: false, error: 'This model could not be previewed.' };
        const wx = v.x + cog.x;
        const wy = v.y + cog.y;
        const wz = v.z + cog.z;
        const [px, py, pz] = armaVecToThree(wx, wy, wz);
        positions.push(px, py, pz);
        normals.push(0, 1, 0);
      }
      indices.push(base, base + 1, base + 2);
    } else if (vidx.length === 4) {
      const corners = vidx.map((vi) => {
        const v = verts[vi];
        if (!v) return null;
        const wx = v.x + cog.x;
        const wy = v.y + cog.y;
        const wz = v.z + cog.z;
        return armaVecToThree(wx, wy, wz);
      });
      if (corners.some((c) => c == null)) return { ok: false, error: 'This model could not be previewed.' };
      const c = corners as [number, number, number][];
      const emit = (a: number, b: number, d: number) => {
        const base = positions.length / 3;
        const p0 = c[a]!;
        const p1 = c[b]!;
        const p2 = c[d]!;
        positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
        indices.push(base, base + 1, base + 2);
      };
      emit(0, 1, 2);
      emit(0, 2, 3);
    }
  }

  if (!indices.length) return { ok: false, error: 'This model could not be previewed.' };

  return {
    ok: true,
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      uvs: null,
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
      lodIndex: lodIdx,
      primaryTexture: null,
      textureNames: [],
    },
  };
}

function readFourCC(buf: Uint8Array, o: number): string {
  return String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
}

/**
 * ODOL preview using ``@bis-toolkit/p3d``. The upstream reader declares a narrow ODOL version range;
 * we temporarily widen it so newer engine builds may still load when the on-disk layout matches.
 */
export function buildPreviewMeshFromOdol(buf: Uint8Array): PreviewMeshResult {
  if (buf.byteLength < 12 || readFourCC(buf, 0) !== 'ODOL') {
    return { ok: false, error: 'This model could not be previewed.' };
  }

  const ctor = Odol as unknown as { MAX_SUPPORTED_VERSION: number; MIN_SUPPORTED_VERSION: number };
  const prevMax = ctor.MAX_SUPPORTED_VERSION;
  const prevMin = ctor.MIN_SUPPORTED_VERSION;
  ctor.MAX_SUPPORTED_VERSION = 250;
  ctor.MIN_SUPPORTED_VERSION = 48;
  try {
    const nodeBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const odol = Odol.fromBuffer(nodeBuf) as unknown as OdolLike;
    return meshFromOdol(odol);
  } catch {
    return { ok: false, error: 'This model could not be previewed.' };
  } finally {
    ctor.MAX_SUPPORTED_VERSION = prevMax;
    ctor.MIN_SUPPORTED_VERSION = prevMin;
  }
}
