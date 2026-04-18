import type { MlodFace, MlodLod, P3D } from './p3d';

/** Interleaved XYZ per vertex: modeling space (Y vertical, XZ horizontal), same as Three.js. */
export type PreviewMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  /** Two floats per vertex when the source LOD carries UVs (MLOD); otherwise null (e.g. ODOL). */
  uvs: Float32Array | null;
  vertexCount: number;
  triangleCount: number;
  /** LOD index used (0-based). */
  lodIndex: number;
  /** Face texture name with the most triangles, for preview resolution. */
  primaryTexture: string | null;
  /** Distinct face texture names, most-used first. */
  textureNames: string[];
};

export type PreviewMeshResult =
  | { ok: true; mesh: PreviewMesh }
  | { ok: false; error: string };

/** Pass-through: MLOD/ODOL vertices are already Y-up (XZ ground plane), matching the preview renderer. */
export function armaVecToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z];
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function pickLodIndex(lods: MlodLod[]): number {
  if (!lods.length) return 0;
  // Prefer last LOD (often geometry / coarse hull); fallback to most vertices.
  let best = lods.length - 1;
  let bestPts = lods[best]?.points?.length ?? 0;
  for (let i = lods.length - 1; i >= 0; i--) {
    const n = lods[i]?.points?.length ?? 0;
    if (n > bestPts) {
      bestPts = n;
      best = i;
    }
  }
  return best;
}

/**
 * Build a triangle mesh from MLOD geometry (P3DM/SP3X LOD).
 * Expands quads to two triangles; duplicates corners for flat shading with corner normals.
 */
export function buildPreviewMeshFromMlod(p3d: P3D, opts?: { lodIndex?: number }): PreviewMeshResult {
  const lodIdx = opts?.lodIndex ?? pickLodIndex(p3d.lods);
  const lod = p3d.lods[lodIdx];
  if (!lod) return { ok: false, error: 'This model could not be previewed.' };
  if (!lod.faces.length) return { ok: false, error: 'This model could not be previewed.' };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const textureCounts = new Map<string, number>();

  const pushCorner = (face: MlodFace, vi: number) => {
    const c = face.vertices[vi]!;
    const pi = c.pointIndex;
    const ni = c.normalIndex;
    if (pi < 0 || pi >= lod.points.length) return false;
    if (ni < 0 || ni >= lod.faceNormals.length) return false;
    const pt = lod.points[pi]!.position;
    const nm = lod.faceNormals[ni]!;
    const [px, py, pz] = armaVecToThree(pt.x, pt.y, pt.z);
    const [nx0, ny0, nz0] = armaVecToThree(nm.x, nm.y, nm.z);
    const [nx, ny, nz] = normalize3(nx0, ny0, nz0);
    positions.push(px, py, pz);
    normals.push(nx, ny, nz);
    uvs.push(c.u, c.v);
    return true;
  };

  const emitTri = (face: MlodFace, a: number, b: number, c: number) => {
    const i0 = positions.length / 3;
    if (!pushCorner(face, a)) return;
    if (!pushCorner(face, b)) return;
    if (!pushCorner(face, c)) return;
    indices.push(i0, i0 + 1, i0 + 2);
    const tex = (face.texture ?? '').trim();
    if (tex) textureCounts.set(tex, (textureCounts.get(tex) ?? 0) + 1);
  };

  for (const face of lod.faces) {
    const nv = face.noOfVerts;
    if (nv === 3) {
      emitTri(face, 0, 1, 2);
    } else if (nv === 4) {
      emitTri(face, 0, 1, 2);
      emitTri(face, 0, 2, 3);
    }
  }

  if (!indices.length) return { ok: false, error: 'This model could not be previewed.' };

  const pos = new Float32Array(positions);
  const nrm = new Float32Array(normals);
  const uvArr = new Float32Array(uvs);
  const idx = new Uint32Array(indices);

  const rankedTextures = [...textureCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const primaryTexture = rankedTextures.length ? rankedTextures[0]![0] : null;
  const textureNames = rankedTextures.map(([t]) => t);

  return {
    ok: true,
    mesh: {
      positions: pos,
      indices: idx,
      normals: nrm,
      uvs: uvArr,
      vertexCount: pos.length / 3,
      triangleCount: idx.length / 3,
      lodIndex: lodIdx,
      primaryTexture,
      textureNames,
    },
  };
}
