import { describe, expect, it } from 'vitest';
import { parseP3DBuffer, writeP3D, type P3D } from './p3d';
import { buildPreviewMeshFromMlod } from './p3dMesh';

function minimalTriangleP3d(): P3D {
  const deadVert: import('./p3d').MlodFaceVertex = {
    pointIndex: 0,
    normalIndex: 0,
    u: 0,
    v: 0,
  };
  return {
    header: { signature: 'MLOD', version: 0x101, noOfLods: 1 },
    lods: [
      {
        signature: 'P3DM',
        majorVersion: 28,
        minorVersion: 256,
        noOfPoints: 3,
        noOfFaceNormals: 3,
        noOfFaces: 1,
        unknownFlagBits: 0,
        points: [
          { position: { x: 0, y: 0, z: 0 }, pointFlags: 0 },
          { position: { x: 1, y: 0, z: 0 }, pointFlags: 0 },
          { position: { x: 0, y: 1, z: 0 }, pointFlags: 0 },
        ],
        faceNormals: [
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
        ],
        faces: [
          {
            noOfVerts: 3,
            vertices: [
              { pointIndex: 0, normalIndex: 0, u: 0, v: 0 },
              { pointIndex: 1, normalIndex: 1, u: 0, v: 0 },
              { pointIndex: 2, normalIndex: 2, u: 0, v: 0 },
              deadVert,
            ],
            faceFlags: 0,
            texture: 'units\\preview_co.paa',
            material: '',
          },
        ],
        taggs: [{ active: 1, name: '#EndOfFile#', data: new Uint8Array(0) }],
        resolution: 1000,
      },
    ],
    defaultPath: '',
  };
}

describe('p3d MLOD', () => {
  it('round-trips a minimal P3DM through write/parse', () => {
    const p3d = minimalTriangleP3d();
    const buf = writeP3D(p3d);
    const again = parseP3DBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const buf2 = writeP3D(again);
    expect(Buffer.compare(buf, buf2)).toBe(0);
    expect(again.lods[0]?.faces.length).toBe(1);
    expect(again.lods[0]?.points.length).toBe(3);
  });

  it('builds a preview mesh with one triangle', () => {
    const p3d = minimalTriangleP3d();
    const r = buildPreviewMeshFromMlod(p3d);
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.mesh.triangleCount).toBe(1);
    expect(r.mesh.vertexCount).toBe(3);
    expect(r.mesh.indices.length).toBe(3);
    expect(r.mesh.uvs?.length).toBe(6);
    expect(r.mesh.primaryTexture).toBe('units\\preview_co.paa');
    expect(r.mesh.textureNames).toContain('units\\preview_co.paa');
  });
});
