import fs from 'node:fs';

// https://community.bistudio.com/wiki/P3D_File_Format_-_MLOD
// Face layout: https://pmc.editing.wiki/doku.php?id=arma%3Afile_formats%3Ap3d_mlod

export type XYZTriplet = { x: number; y: number; z: number };

export type MlodFaceVertex = {
  pointIndex: number;
  normalIndex: number;
  u: number;
  v: number;
};

export type MlodFace = {
  noOfVerts: number;
  vertices: [MlodFaceVertex, MlodFaceVertex, MlodFaceVertex, MlodFaceVertex];
  faceFlags: number;
  texture: string;
  material: string;
};

export type MlodPoint = {
  position: XYZTriplet;
  /** Present for P3DM / SP3X; omitted for SP3D demo LODs. */
  pointFlags?: number;
};

export type MlodTagg = {
  /** P3DM only; wiki says always 1. */
  active: number;
  name: string;
  /** Raw payload after tag header (may be empty). */
  data: Uint8Array;
  /** SP3X: preserve exact 64-byte name field for round-trip. */
  sp3xNameField?: Uint8Array;
};

export type MlodLod = {
  signature: 'P3DM' | 'SP3X' | 'SP3D' | string;
  majorVersion: number;
  minorVersion: number;
  noOfPoints: number;
  noOfFaceNormals: number;
  noOfFaces: number;
  unknownFlagBits: number;
  points: MlodPoint[];
  faceNormals: XYZTriplet[];
  faces: MlodFace[];
  taggs: MlodTagg[];
  resolution: number;
};

export type P3DHeader = {
  signature: 'MLOD';
  version: number;
  noOfLods: number;
};

export type P3D = {
  header: P3DHeader;
  lods: MlodLod[];
  /** OFP trailing 32-byte default path after last LOD (may be empty). */
  defaultPath: string;
};

export class P3DParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'P3DParseError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

function readFourCC(buf: Uint8Array, o: number): string {
  if (o + 4 > buf.length) throw new P3DParseError('Unexpected end of file (fourcc).');
  return String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
}

function readU32LE(buf: Uint8Array, o: number): number {
  if (o + 4 > buf.length) throw new P3DParseError('Unexpected end of file (u32).');
  return (
    buf[o]! |
    (buf[o + 1]! << 8) |
    (buf[o + 2]! << 16) |
    (buf[o + 3]! << 24)
  ) >>> 0;
}

function readI32LE(buf: Uint8Array, o: number): number {
  const u = readU32LE(buf, o);
  return u | 0;
}

function readF32LE(buf: Uint8Array, o: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + o, 4);
  return view.getFloat32(0, true);
}

function readAsciiz(buf: Uint8Array, start: number): { value: string; next: number } {
  let i = start;
  while (i < buf.length && buf[i] !== 0) i++;
  const value = dec.decode(buf.subarray(start, i));
  const next = Math.min(i + 1, buf.length);
  return { value, next };
}

function writeU32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function writeI32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n | 0, 0);
  return b;
}

function writeF32LE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n, 0);
  return b;
}

function writeFourCC(s: string): Buffer {
  const b = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) {
    b[i] = s.charCodeAt(i) & 255;
  }
  return b;
}

function writeAsciiz(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
}

function readXYZ(buf: Uint8Array, o: number): { v: XYZTriplet; next: number } {
  return {
    v: { x: readF32LE(buf, o), y: readF32LE(buf, o + 4), z: readF32LE(buf, o + 8) },
    next: o + 12,
  };
}

function readFace(buf: Uint8Array, o: number): { face: MlodFace; next: number } {
  let p = o;
  const noOfVerts = readI32LE(buf, p);
  p += 4;
  const verts: MlodFaceVertex[] = [];
  for (let i = 0; i < 4; i++) {
    verts.push({
      pointIndex: readI32LE(buf, p),
      normalIndex: readI32LE(buf, p + 4),
      u: readF32LE(buf, p + 8),
      v: readF32LE(buf, p + 12),
    });
    p += 16;
  }
  const faceFlags = readI32LE(buf, p);
  p += 4;
  const tex = readAsciiz(buf, p);
  p = tex.next;
  const mat = readAsciiz(buf, p);
  p = mat.next;
  const face: MlodFace = {
    noOfVerts,
    vertices: verts as [MlodFaceVertex, MlodFaceVertex, MlodFaceVertex, MlodFaceVertex],
    faceFlags,
    texture: tex.value,
    material: mat.value,
  };
  return { face, next: p };
}

function writeFace(face: MlodFace): Buffer {
  const parts: Buffer[] = [];
  parts.push(writeI32LE(face.noOfVerts));
  for (const v of face.vertices) {
    parts.push(writeI32LE(v.pointIndex));
    parts.push(writeI32LE(v.normalIndex));
    parts.push(writeF32LE(v.u));
    parts.push(writeF32LE(v.v));
  }
  parts.push(writeI32LE(face.faceFlags));
  parts.push(writeAsciiz(face.texture));
  parts.push(writeAsciiz(face.material));
  return Buffer.concat(parts);
}

function readTaggP3dm(buf: Uint8Array, o: number): { tagg: MlodTagg; next: number } {
  const active = buf[o]!;
  let p = o + 1;
  const name = readAsciiz(buf, p);
  p = name.next;
  const dataLen = readU32LE(buf, p);
  p += 4;
  if (p + dataLen > buf.length) throw new P3DParseError('Tagg data past end of file.');
  const data = buf.subarray(p, p + dataLen);
  p += dataLen;
  return { tagg: { active, name: name.value, data: new Uint8Array(data) }, next: p };
}

function readTaggSp3x(buf: Uint8Array, o: number): { tagg: MlodTagg; next: number } {
  if (o + 64 > buf.length) throw new P3DParseError('SP3X tagg name field truncated.');
  const nameField = buf.subarray(o, o + 64);
  const nz = nameField.indexOf(0);
  const name = dec.decode(nz < 0 ? nameField : nameField.subarray(0, nz));
  let p = o + 64;
  const dataLen = readU32LE(buf, p);
  p += 4;
  if (p + dataLen > buf.length) throw new P3DParseError('SP3X tagg data past end of file.');
  const data = buf.subarray(p, p + dataLen);
  p += dataLen;
  return {
    tagg: {
      active: 1,
      name,
      data: new Uint8Array(data),
      sp3xNameField: new Uint8Array(nameField),
    },
    next: p,
  };
}

function writeTaggP3dm(t: MlodTagg): Buffer {
  return Buffer.concat([
    Buffer.from([t.active & 255]),
    writeAsciiz(t.name),
    writeU32LE(t.data.byteLength),
    Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength),
  ]);
}

function writeTaggSp3x(t: MlodTagg): Buffer {
  const nameBuf = Buffer.alloc(64, 0);
  if (t.sp3xNameField && t.sp3xNameField.byteLength === 64) {
    nameBuf.set(Buffer.from(t.sp3xNameField.buffer, t.sp3xNameField.byteOffset, 64));
  } else {
    const raw = enc.encode(t.name);
    nameBuf.set(raw.subarray(0, Math.min(raw.length, 63)));
  }
  return Buffer.concat([
    nameBuf,
    writeU32LE(t.data.byteLength),
    Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength),
  ]);
}

function parseLod(buf: Uint8Array, o: number, sig: string): { lod: MlodLod; next: number } {
  let p = o;
  if (sig === 'SP3D') {
    throw new P3DParseError('SP3D demo LOD is not supported.');
  }
  const majorVersion = readU32LE(buf, p);
  p += 4;
  const minorVersion = readU32LE(buf, p);
  p += 4;
  const noOfPoints = readU32LE(buf, p);
  p += 4;
  const noOfFaceNormals = readU32LE(buf, p);
  p += 4;
  const noOfFaces = readU32LE(buf, p);
  p += 4;
  const unknownFlagBits = readU32LE(buf, p);
  p += 4;

  const points: MlodPoint[] = [];
  for (let i = 0; i < noOfPoints; i++) {
    const { v, next } = readXYZ(buf, p);
    p = next;
    const pointFlags = readU32LE(buf, p);
    p += 4;
    points.push({ position: v, pointFlags });
  }

  const faceNormals: XYZTriplet[] = [];
  for (let i = 0; i < noOfFaceNormals; i++) {
    const { v, next } = readXYZ(buf, p);
    p = next;
    faceNormals.push(v);
  }

  const faces: MlodFace[] = [];
  for (let i = 0; i < noOfFaces; i++) {
    const { face, next } = readFace(buf, p);
    p = next;
    faces.push(face);
  }

  const tagMagic = readFourCC(buf, p);
  p += 4;
  if (tagMagic !== 'TAGG') {
    throw new P3DParseError(`Expected TAGG section, got "${tagMagic}".`);
  }

  const taggs: MlodTagg[] = [];
  const isSp3x = sig === 'SP3X';
  for (;;) {
    if (p >= buf.length) throw new P3DParseError('Truncated TAGG section.');
    if (isSp3x) {
      const { tagg, next } = readTaggSp3x(buf, p);
      p = next;
      taggs.push(tagg);
      if (tagg.name === '#EndOfFile#' && tagg.data.byteLength === 0) break;
    } else {
      const { tagg, next } = readTaggP3dm(buf, p);
      p = next;
      taggs.push(tagg);
      if (tagg.name === '#EndOfFile#' && tagg.data.byteLength === 0) break;
    }
  }

  const resolution = readF32LE(buf, p);
  p += 4;

  const lod: MlodLod = {
    signature: sig,
    majorVersion,
    minorVersion,
    noOfPoints,
    noOfFaceNormals,
    noOfFaces,
    unknownFlagBits,
    points,
    faceNormals,
    faces,
    taggs,
    resolution,
  };
  return { lod, next: p };
}

/**
 * Parse MLOD P3D bytes. Supports ``MLOD`` header + ``P3DM`` / ``SP3X`` LODs, or headerless single LOD starting with ``P3DM``/``SP3X``.
 */
export function parseP3DBuffer(buf: Uint8Array): P3D {
  if (buf.byteLength < 4) throw new P3DParseError('File too small.');
  const magic = readFourCC(buf, 0);
  let offset = 0;
  let header: P3DHeader;
  let noOfLods: number;

  if (magic === 'MLOD') {
    if (buf.byteLength < 12) throw new P3DParseError('Truncated MLOD header.');
    const version = readU32LE(buf, 4);
    noOfLods = readU32LE(buf, 8);
    if (noOfLods < 1 || noOfLods > 10_000) throw new P3DParseError('Invalid LOD count.');
    header = { signature: 'MLOD', version, noOfLods };
    offset = 12;
  } else if (magic === 'P3DM' || magic === 'SP3X') {
    header = { signature: 'MLOD', version: 0x101, noOfLods: 1 };
    noOfLods = 1;
    offset = 0;
  } else {
    throw new P3DParseError('Not a supported MLOD P3D (expected MLOD, P3DM, or SP3X).');
  }

  const lods: MlodLod[] = [];
  for (let i = 0; i < noOfLods; i++) {
    if (offset + 4 > buf.length) throw new P3DParseError('Truncated LOD signature.');
    const sig = readFourCC(buf, offset);
    offset += 4;
    const { lod, next } = parseLod(buf, offset, sig);
    lods.push(lod);
    offset = next;
  }

  let defaultPath = '';
  if (offset + 32 <= buf.length) {
    defaultPath = dec.decode(buf.subarray(offset, offset + 32));
    const z = defaultPath.indexOf('\0');
    if (z >= 0) defaultPath = defaultPath.slice(0, z);
    offset += 32;
  }

  return { header, lods, defaultPath };
}

export function parseP3DFile(filePath: string): P3D {
  const file = fs.readFileSync(filePath);
  return parseP3DBuffer(new Uint8Array(file.buffer, file.byteOffset, file.byteLength));
}

/** @deprecated Use ``parseP3DFile`` / ``parseP3DBuffer``. */
export function parseP3D(filePath: string): P3D | null {
  try {
    return parseP3DFile(filePath);
  } catch {
    return null;
  }
}

function writeLod(lod: MlodLod): Buffer {
  const isSp3x = lod.signature === 'SP3X';
  const sig4 = lod.signature.length >= 4 ? lod.signature.slice(0, 4) : `${lod.signature}    `.slice(0, 4);
  const parts: Buffer[] = [];
  parts.push(writeFourCC(sig4));
  if (lod.signature === 'SP3D') {
    throw new P3DParseError('Cannot serialize SP3D LOD.');
  }
  const noOfPoints = lod.points.length;
  const noOfFaceNormals = lod.faceNormals.length;
  const noOfFaces = lod.faces.length;
  parts.push(writeU32LE(lod.majorVersion));
  parts.push(writeU32LE(lod.minorVersion));
  parts.push(writeU32LE(noOfPoints));
  parts.push(writeU32LE(noOfFaceNormals));
  parts.push(writeU32LE(noOfFaces));
  parts.push(writeU32LE(lod.unknownFlagBits));

  for (const pt of lod.points) {
    parts.push(writeF32LE(pt.position.x));
    parts.push(writeF32LE(pt.position.y));
    parts.push(writeF32LE(pt.position.z));
    parts.push(writeU32LE(pt.pointFlags ?? 0));
  }
  for (const n of lod.faceNormals) {
    parts.push(writeF32LE(n.x));
    parts.push(writeF32LE(n.y));
    parts.push(writeF32LE(n.z));
  }
  for (const f of lod.faces) {
    parts.push(writeFace(f));
  }

  parts.push(writeFourCC('TAGG'));
  for (const t of lod.taggs) {
    parts.push(isSp3x ? writeTaggSp3x(t) : writeTaggP3dm(t));
  }
  parts.push(writeF32LE(lod.resolution));
  return Buffer.concat(parts);
}

export function writeP3D(p3d: P3D): Buffer {
  const parts: Buffer[] = [];
  parts.push(writeFourCC('MLOD'));
  parts.push(writeU32LE(p3d.header.version));
  parts.push(writeU32LE(p3d.lods.length));
  for (const lod of p3d.lods) {
    parts.push(writeLod(lod));
  }
  const dp = Buffer.alloc(32, 0);
  const raw = enc.encode(p3d.defaultPath ?? '');
  dp.set(raw.subarray(0, Math.min(raw.length, 31)));
  parts.push(dp);
  return Buffer.concat(parts);
}
