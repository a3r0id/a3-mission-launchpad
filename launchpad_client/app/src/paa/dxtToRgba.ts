/** Decode DXT1 (BC1) or DXT5 (BC3) surface bytes to RGBA8 (top-left origin). */

function unpackRgb565(v: number): { r: number; g: number; b: number } {
  let r = (v >> 11) & 31;
  let g = (v >> 5) & 63;
  let b = v & 31;
  r = (r << 3) | (r >> 2);
  g = (g << 2) | (g >> 4);
  b = (b << 3) | (b >> 2);
  return { r, g, b };
}

function decodeAlphaBlock(block: Uint8Array, o: number, outAlpha16: number[]): void {
  const a0 = block[o];
  const a1 = block[o + 1];
  const a: number[] = [];
  a[0] = a0;
  a[1] = a1;
  if (a0 > a1) {
    for (let i = 2; i < 8; i++) {
      a[i] = (((8 - i) * a0 + (i - 1) * a1) / 7) | 0;
    }
  } else {
    for (let i = 2; i < 6; i++) {
      a[i] = (((6 - i) * a0 + (i - 1) * a1) / 5) | 0;
    }
    a[6] = 0;
    a[7] = 255;
  }
  let bits = 0;
  for (let i = 0; i < 6; i++) {
    bits |= block[o + 2 + i] << (8 * i);
  }
  for (let i = 0; i < 16; i++) {
    const code = (bits >> (3 * i)) & 7;
    outAlpha16[i] = a[code];
  }
}

function decodeColorBlock(
  block: Uint8Array,
  o: number,
  outRgb16: { r: number; g: number; b: number }[],
  outA16: number[],
  /** DXT5 color block always uses four interpolated RGB colours (alpha is separate). */
  dxt5Color: boolean,
): void {
  const c0 = block[o] | (block[o + 1] << 8);
  const c1 = block[o + 2] | (block[o + 3] << 8);
  const bits = block[o + 4] | (block[o + 5] << 8) | (block[o + 6] << 16) | (block[o + 7] << 24);
  const p0 = unpackRgb565(c0);
  const p1 = unpackRgb565(c1);
  const colors: { r: number; g: number; b: number }[] = [];
  colors[0] = p0;
  colors[1] = p1;
  if (dxt5Color || c0 > c1) {
    colors[2] = {
      r: ((2 * p0.r + p1.r) / 3) | 0,
      g: ((2 * p0.g + p1.g) / 3) | 0,
      b: ((2 * p0.b + p1.b) / 3) | 0,
    };
    colors[3] = {
      r: ((p0.r + 2 * p1.r) / 3) | 0,
      g: ((p0.g + 2 * p1.g) / 3) | 0,
      b: ((p0.b + 2 * p1.b) / 3) | 0,
    };
  } else {
    colors[2] = {
      r: ((p0.r + p1.r) >> 1) | 0,
      g: ((p0.g + p1.g) >> 1) | 0,
      b: ((p0.b + p1.b) >> 1) | 0,
    };
    colors[3] = { r: 0, g: 0, b: 0 };
  }
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const idx = py * 4 + px;
      const code = (bits >> (2 * idx)) & 3;
      const c = colors[code];
      outRgb16[idx] = c;
      if (!dxt5Color) {
        outA16[idx] = c0 > c1 || code !== 3 ? 255 : 0;
      }
    }
  }
}

export function dxtByteSize(width: number, height: number, dxt5: boolean): number {
  const bw = Math.max(1, Math.floor((width + 3) / 4));
  const bh = Math.max(1, Math.floor((height + 3) / 4));
  return bw * bh * (dxt5 ? 16 : 8);
}

export function decodeDxtToRgba(dxt: Uint8Array, width: number, height: number, dxt5: boolean): Uint8Array {
  const expected = dxtByteSize(width, height, dxt5);
  if (dxt.byteLength < expected) {
    throw new Error('DXT payload is shorter than expected for the given dimensions.');
  }
  const nbw = Math.max(1, Math.floor((width + 3) / 4));
  const nbh = Math.max(1, Math.floor((height + 3) / 4));
  const rgba = new Uint8Array(width * height * 4);
  const rgb = Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }));
  const alpha = new Array<number>(16).fill(255);
  const colorRgb = Array.from({ length: 16 }, () => ({ r: 0, g: 0, b: 0 }));
  const dummyA = new Array<number>(16);

  let src = 0;
  for (let by = 0; by < nbh; by++) {
    for (let bx = 0; bx < nbw; bx++) {
      if (dxt5) {
        decodeAlphaBlock(dxt, src, alpha);
        decodeColorBlock(dxt, src + 8, colorRgb, dummyA, true);
        src += 16;
      } else {
        decodeColorBlock(dxt, src, rgb, alpha, false);
        src += 8;
      }
      const pix = dxt5 ? colorRgb : rgb;
      const pixA = dxt5 ? alpha : alpha;
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const gx = bx * 4 + px;
          const gy = by * 4 + py;
          if (gx >= width || gy >= height) {
            continue;
          }
          const idx = py * 4 + px;
          const di = (gy * width + gx) * 4;
          const c = pix[idx];
          rgba[di] = c.r;
          rgba[di + 1] = c.g;
          rgba[di + 2] = c.b;
          rgba[di + 3] = pixA[idx];
        }
      }
    }
  }
  return rgba;
}
