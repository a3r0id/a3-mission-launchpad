/**
 * LZO1x decompressor (MIT): algorithm ported from {@link https://github.com/jackoalan/lzokay lzokay}
 * (see {@link https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git/tree/Documentation/lzo.txt Linux LZO notes}).
 * Used for optional LZO-wrapped DXT mip payloads in Arma 3 PAA files.
 */

const Max255Count = Math.floor(0xffffffff / 255) - 2;

function getLe16(src: Uint8Array, off: number): number {
  return src[off] | (src[off + 1] << 8);
}

const M3Marker = 0x20;
const M4Marker = 0x10;

export const enum LzoDecompressResultCode {
  Success = 0,
  InputNotConsumed = 1,
  Error = -1,
  InputOverrun = -2,
  OutputOverrun = -3,
  LookbehindOverrun = -4,
}

export type LzoDecompressResult =
  | { code: LzoDecompressResultCode.Success | LzoDecompressResultCode.InputNotConsumed; written: number }
  | { code: Exclude<LzoDecompressResultCode, LzoDecompressResultCode.Success | LzoDecompressResultCode.InputNotConsumed> };

/**
 * Decompress LZO1x-compressed bytes into a pre-sized output buffer (Arma PAA mip size is known from DXT layout).
 */
export function decompressLzo1x(src: Uint8Array, dst: Uint8Array): LzoDecompressResult {
  const initDstSize = dst.length;
  if (src.length < 3) {
    return { code: LzoDecompressResultCode.InputOverrun };
  }

  const inpEnd = src.length;
  let inp = 0;
  let outp = 0;
  let lbcur = 0;
  let lblen = 0;
  let state = 0;
  let nstate = 0;

  const needsIn = (count: number): boolean => inp + count <= inpEnd;
  const needsOut = (count: number): boolean => outp + count <= initDstSize;

  if (src[inp] >= 22) {
    const len = src[inp++] - 17;
    if (!needsIn(len) || !needsOut(len)) {
      return { code: !needsIn(len) ? LzoDecompressResultCode.InputOverrun : LzoDecompressResultCode.OutputOverrun };
    }
    for (let i = 0; i < len; i++) {
      dst[outp++] = src[inp++];
    }
    state = 4;
  } else if (src[inp] >= 18) {
    nstate = src[inp++] - 17;
    state = nstate;
    if (!needsIn(nstate) || !needsOut(nstate)) {
      return { code: !needsIn(nstate) ? LzoDecompressResultCode.InputOverrun : LzoDecompressResultCode.OutputOverrun };
    }
    for (let i = 0; i < nstate; i++) {
      dst[outp++] = src[inp++];
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!needsIn(1)) {
      return { code: LzoDecompressResultCode.InputOverrun };
    }
    const inst = src[inp++];

    if (inst & 0xc0) {
      if (!needsIn(1)) {
        return { code: LzoDecompressResultCode.InputOverrun };
      }
      const dist = (src[inp++] << 3) + ((inst >> 2) & 7) + 1;
      lbcur = outp - dist;
      lblen = (inst >> 5) + 1;
      nstate = inst & 3;
    } else if (inst & M3Marker) {
      lblen = (inst & 0x1f) + 2;
      if (lblen === 2) {
        const oldInp = inp;
        while (inp < inpEnd && src[inp] === 0) {
          inp++;
        }
        const offset = inp - oldInp;
        if (offset > Max255Count) {
          return { code: LzoDecompressResultCode.Error };
        }
        if (!needsIn(1)) {
          return { code: LzoDecompressResultCode.InputOverrun };
        }
        lblen += offset * 255 + 31 + src[inp++];
      }
      if (!needsIn(2)) {
        return { code: LzoDecompressResultCode.InputOverrun };
      }
      nstate = getLe16(src, inp);
      inp += 2;
      lbcur = outp - ((nstate >> 2) + 1);
      nstate &= 3;
    } else if (inst & M4Marker) {
      lblen = (inst & 7) + 2;
      if (lblen === 2) {
        const oldInp = inp;
        while (inp < inpEnd && src[inp] === 0) {
          inp++;
        }
        const offset = inp - oldInp;
        if (offset > Max255Count) {
          return { code: LzoDecompressResultCode.Error };
        }
        if (!needsIn(1)) {
          return { code: LzoDecompressResultCode.InputOverrun };
        }
        lblen += offset * 255 + 7 + src[inp++];
      }
      if (!needsIn(2)) {
        return { code: LzoDecompressResultCode.InputOverrun };
      }
      nstate = getLe16(src, inp);
      inp += 2;
      lbcur = outp - (((inst & 8) << 11) + (nstate >> 2));
      nstate &= 3;
      if (lbcur === outp) {
        break;
      }
      lbcur -= 16384;
    } else {
      if (state === 0) {
        let len = inst + 3;
        if (len === 3) {
          const oldInp = inp;
          while (inp < inpEnd && src[inp] === 0) {
            inp++;
          }
          const offset = inp - oldInp;
          if (offset > Max255Count) {
            return { code: LzoDecompressResultCode.Error };
          }
          if (!needsIn(1)) {
            return { code: LzoDecompressResultCode.InputOverrun };
          }
          len += offset * 255 + 15 + src[inp++];
        }
        if (!needsIn(len) || !needsOut(len)) {
          return { code: !needsIn(len) ? LzoDecompressResultCode.InputOverrun : LzoDecompressResultCode.OutputOverrun };
        }
        for (let i = 0; i < len; i++) {
          dst[outp++] = src[inp++];
        }
        state = 4;
        continue;
      }
      if (state !== 4) {
        if (!needsIn(1)) {
          return { code: LzoDecompressResultCode.InputOverrun };
        }
        nstate = inst & 3;
        lbcur = outp - ((inst >> 2) + (src[inp++] << 2) + 1);
        lblen = 2;
      } else {
        if (!needsIn(1)) {
          return { code: LzoDecompressResultCode.InputOverrun };
        }
        nstate = inst & 3;
        lbcur = outp - ((inst >> 2) + (src[inp++] << 2) + 2049);
        lblen = 3;
      }
    }

    if (lbcur < 0) {
      return { code: LzoDecompressResultCode.LookbehindOverrun };
    }
    if (!needsIn(nstate) || !needsOut(lblen + nstate)) {
      return { code: !needsIn(nstate) ? LzoDecompressResultCode.InputOverrun : LzoDecompressResultCode.OutputOverrun };
    }
    let from = lbcur;
    for (let i = 0; i < lblen; i++) {
      dst[outp++] = dst[from++];
    }
    state = nstate;
    for (let i = 0; i < nstate; i++) {
      dst[outp++] = src[inp++];
    }
  }

  if (lblen !== 3) {
    return { code: LzoDecompressResultCode.Error };
  }
  if (inp === inpEnd) {
    return { code: LzoDecompressResultCode.Success, written: outp };
  }
  if (inp < inpEnd) {
    return { code: LzoDecompressResultCode.InputNotConsumed, written: outp };
  }
  return { code: LzoDecompressResultCode.InputOverrun };
}
