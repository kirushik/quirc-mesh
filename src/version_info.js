// Version determination via the version-information BCH(18,6) blocks (v >= 7).
//
// quirc derives the version purely from measure_grid_size (finder geometry), which
// drifts under lens/perspective distortion and can land a whole step off — fatal,
// since the wrong grid size misreads everything. For v >= 7 the symbol carries two
// redundant 18-bit version blocks with strong BCH error correction; we read them
// to PIN the true version. This is an addition over stock quirc.

import { perspectiveSetup, perspectiveMap } from "./perspective.js";
import { gridSize } from "./version_db.js";

const VERSION_GEN = 0x1f25; // BCH generator x^12+x^11+x^10+x^9+x^8+x^5+x^2+1

export function versionBchEncode(v) {
  let r = v << 12;
  for (let i = 17; i >= 12; i--) if (r & (1 << i)) r ^= VERSION_GEN << (i - 12);
  return (v << 12) | (r & 0xfff);
}

const VERSION_CODES = [];
for (let v = 7; v <= 40; v++) VERSION_CODES.push([v, versionBchEncode(v)]);

function hamming(a, b) {
  let x = a ^ b, c = 0;
  while (x) { c += x & 1; x >>>= 1; }
  return c;
}

// Nearest valid version codeword within Hamming distance 3, else -1.
export function decodeVersionBits(bits) {
  let best = -1, bestD = 99;
  for (const [v, code] of VERSION_CODES) {
    const d = hamming(bits, code);
    if (d < bestD) { bestD = d; best = v; }
  }
  return bestD <= 3 ? best : -1;
}

function cellBit(q, c, col, row) {
  const p = perspectiveMap(c, col + 0.5, row + 0.5);
  if (p.x < 0 || p.y < 0 || p.x >= q.w || p.y >= q.h) return 0;
  return q.pixels[p.y * q.w + p.x] ? 1 : 0;
}

// Two redundant version blocks, read MSB-first in ISO 18004 order (matches ZXing).
function readVersionTR(q, c, size) {
  let bits = 0;
  for (let j = 5; j >= 0; j--)
    for (let i = size - 9; i >= size - 11; i--)
      bits = (bits << 1) | cellBit(q, c, i, j);
  return bits;
}
function readVersionBL(q, c, size) {
  let bits = 0;
  for (let i = 5; i >= 0; i--)
    for (let j = size - 9; j >= size - 11; j--)
      bits = (bits << 1) | cellBit(q, c, i, j);
  return bits;
}

// Build a coarse perspective for a candidate grid size from the four anchors
// (3 finder corners + the located bottom-right alignment point).
function perspectiveForSize(q, qr, gs) {
  // Prefer the grid's finder snapshot (finder.js): shared capstones may have been
  // re-rotated by a later grid since this one was recorded.
  const c0 = (i) => qr.capSnap ? qr.capSnap[i].c0 : q.capstones[qr.caps[i]].corners[0];
  const rect = [
    { x: c0(1).x, y: c0(1).y },
    { x: c0(2).x, y: c0(2).y },
    { x: qr.align.x, y: qr.align.y },
    { x: c0(0).x, y: c0(0).y },
  ];
  return perspectiveSetup(rect, gs - 7, gs - 7);
}

// Determine the true version of a detected grid. For v>=7 candidates near the
// geometric estimate, rebuild the perspective for that size, read the version
// blocks, and accept the version whose BCH validates. Updates qr.gridSize/qr.c on
// a correction. Returns the version (or the geometric estimate if unresolved).
export function refineVersion(q, qr) {
  const estV = (qr.gridSize - 17) / 4;
  if (estV < 7) return estV; // no version info on v1-6; trust geometry

  // Try the estimate first, then nearest neighbours outward.
  const order = [0, -1, 1, -2, 2, -3, 3];
  for (const d of order) {
    const v = estV + d;
    if (v < 7 || v > 40) continue;
    const gs = gridSize(v);
    const c = perspectiveForSize(q, qr, gs);
    if (decodeVersionBits(readVersionTR(q, c, gs)) === v ||
        decodeVersionBits(readVersionBL(q, c, gs)) === v) {
      if (v !== estV) { qr.gridSize = gs; qr.c = c; }
      return v;
    }
  }
  return estV;
}
