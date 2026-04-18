/**
 * Arma 3 PAA (DXT1 / DXT5) → RGBA8888.
 * Binary layout follows the community ImHex pattern for {@link https://community.bistudio.com/wiki/PAA_File_Format PAA}.
 */

import { decodeDxtToRgba, dxtByteSize } from './dxtToRgba';
import { decompressLzo1x, LzoDecompressResultCode } from './lzo1xDecompress';

export const PAA_DXT1 = 0xff01;
export const PAA_DXT5 = 0xff05;

function readAscii4(data: Uint8Array, off: number): string {
  if (off + 4 > data.length) {
    return '';
  }
  return String.fromCharCode(data[off], data[off + 1], data[off + 2], data[off + 3]);
}

function readU24LE(data: Uint8Array, off: number): number {
  return data[off] | (data[off + 1] << 8) | (data[off + 2] << 16);
}

type ParsedMip = {
  width: number;
  height: number;
  /** Raw mip bytes (LZO-compressed or raw DXT) */
  payload: Uint8Array;
  lzoWrapped: boolean;
};

export type DecodePaaFileResult =
  | { ok: true; width: number; height: number; rgba: Uint8Array }
  | { ok: false; error: string };

/**
 * Decode a PAA file buffer to top-left RGBA8888 bytes (suitable for ``ImageData`` or WebGL uploads).
 */
export function decodePaaFileBuffer(fileBytes: Uint8Array): DecodePaaFileResult {
  if (fileBytes.length < 2 + 2 + 3) {
    return { ok: false, error: 'File is too small to be a PAA texture.' };
  }
  const format = fileBytes[0] | (fileBytes[1] << 8);
  const dxt5 = format === PAA_DXT5;
  const dxt1 = format === PAA_DXT1;
  if (!dxt5 && !dxt1) {
    return { ok: false, error: 'This texture format is not supported for preview.' };
  }

  let o = 2;
  while (o + 4 <= fileBytes.length && readAscii4(fileBytes, o) === 'GGAT') {
    if (o + 12 > fileBytes.length) {
      return { ok: false, error: 'Texture file structure looks damaged (tags).' };
    }
    const tagLen = fileBytes[o + 8] | (fileBytes[o + 9] << 8) | (fileBytes[o + 10] << 16) | (fileBytes[o + 11] << 24);
    o += 12 + tagLen;
    if (o > fileBytes.length) {
      return { ok: false, error: 'Texture file structure looks damaged (tag length).' };
    }
  }

  if (o + 2 > fileBytes.length) {
    return { ok: false, error: 'Texture file structure looks damaged (palette).' };
  }
  const palCount = fileBytes[o] | (fileBytes[o + 1] << 8);
  o += 2 + palCount * 3;
  if (o > fileBytes.length) {
    return { ok: false, error: 'Texture file structure looks damaged (palette data).' };
  }

  const mips: ParsedMip[] = [];
  while (o + 4 <= fileBytes.length) {
    const wfield = fileBytes[o] | (fileBytes[o + 1] << 8);
    const h = fileBytes[o + 2] | (fileBytes[o + 3] << 8);
    o += 4;
    if (wfield === 0 && h === 0) {
      if (o + 2 <= fileBytes.length) {
        o += 2;
      }
      break;
    }
    const width = wfield & 0x7fff;
    const lzoWrapped = (wfield & 0x8000) !== 0;
    if (o + 3 > fileBytes.length) {
      return { ok: false, error: 'Texture file structure looks damaged (mipmap size).' };
    }
    const payloadSize = readU24LE(fileBytes, o);
    o += 3;
    if (o + payloadSize > fileBytes.length || payloadSize < 0) {
      return { ok: false, error: 'Texture file structure looks damaged (mipmap data).' };
    }
    const payload = fileBytes.subarray(o, o + payloadSize);
    o += payloadSize;
    mips.push({ width, height: h, payload, lzoWrapped });
  }

  if (mips.length === 0) {
    return { ok: false, error: 'No image data found in this texture file.' };
  }

  let best = mips[0];
  let bestArea = best.width * best.height;
  for (let i = 1; i < mips.length; i++) {
    const m = mips[i];
    const a = m.width * m.height;
    if (a > bestArea) {
      best = m;
      bestArea = a;
    }
  }

  const { width, height, payload, lzoWrapped } = best;
  if (width < 1 || height < 1 || width > 16384 || height > 16384) {
    return { ok: false, error: 'Texture dimensions are not valid.' };
  }

  const dxtExpected = dxtByteSize(width, height, dxt5);
  let dxtBytes: Uint8Array;
  if (lzoWrapped) {
    const tmp = new Uint8Array(dxtExpected);
    const res = decompressLzo1x(payload, tmp);
    if (
      res.code !== LzoDecompressResultCode.Success &&
      res.code !== LzoDecompressResultCode.InputNotConsumed
    ) {
      return { ok: false, error: 'Could not unpack compressed texture data.' };
    }
    if (res.written !== dxtExpected) {
      return { ok: false, error: 'Compressed texture data size did not match expected layout.' };
    }
    dxtBytes = tmp;
  } else {
    if (payload.byteLength < dxtExpected) {
      return { ok: false, error: 'Texture data is shorter than expected for its resolution.' };
    }
    dxtBytes = payload.byteLength === dxtExpected ? payload : payload.subarray(0, dxtExpected);
  }

  try {
    const rgba = decodeDxtToRgba(dxtBytes, width, height, dxt5);
    return { ok: true, width, height, rgba };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not decode texture data.';
    return { ok: false, error: msg };
  }
}
