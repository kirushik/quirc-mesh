// Finder (capstone) detection, capstone grouping into candidate grids, grid-size
// estimation and the single-homography perspective fit. Port of quirc identify.c
// (detection half). Operates on the shared state `q`.
//
// NOTE: this consolidates identify.c's detection driver; region-level primitives
// live in region.js. find_alignment_pattern here is the single-pattern version
// quirc uses for its one-homography fit (M1). M2 adds full mesh alignment in
// alignment.js without changing this file's grid bookkeeping.

import { PIXEL_BLACK } from "./binarize.js";
import { regionCode, findRegionCorners, findLeftmostToLine, floodFillSeed } from "./region.js";
import { perspectiveSetup, perspectiveMap, perspectiveUnmap } from "./perspective.js";
import { VERSION_DB } from "./version_db.js";

const MAX_CAPSTONES = 32;
const MAX_GRIDS = MAX_CAPSTONES * 2;

function lineIntersect(p0, p1, q0, q1) {
  const a = -(p1.y - p0.y);
  const b = p1.x - p0.x;
  const c = -(q1.y - q0.y);
  const d = q1.x - q0.x;
  const e = a * p1.x + b * p1.y;
  const f = c * q1.x + d * q1.y;
  const det = a * d - b * c;
  if (!det) return null;
  return { x: Math.trunc((d * e - b * f) / det), y: Math.trunc((-c * e + a * f) / det) };
}

function length(a, b) {
  const x = Math.abs(a.x - b.x) + 1;
  const y = Math.abs(a.y - b.y) + 1;
  return Math.sqrt(x * x + y * y);
}

function recordCapstone(q, ring, stone) {
  if (q.capstones.length >= MAX_CAPSTONES) return;
  const stoneReg = q.regions[stone];
  const ringReg = q.regions[ring];
  const csIndex = q.capstones.length;
  const capstone = {
    ring, stone,
    corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    center: { x: 0, y: 0 },
    c: null,
    qrGrid: -1,
  };
  q.capstones.push(capstone);
  stoneReg.capstone = csIndex;
  ringReg.capstone = csIndex;

  findRegionCorners(q, ring, stoneReg.seed, capstone.corners);
  capstone.c = perspectiveSetup(capstone.corners, 7.0, 7.0);
  capstone.center = perspectiveMap(capstone.c, 3.5, 3.5);
}

function testCapstone(q, x, y, pb) {
  const ringRight = regionCode(q, x - pb[4], y);
  const stone = regionCode(q, x - pb[4] - pb[3] - pb[2], y);
  const ringLeft = regionCode(q, x - pb[4] - pb[3] - pb[2] - pb[1] - pb[0], y);

  if (ringLeft < 0 || ringRight < 0 || stone < 0) return;
  if (ringLeft !== ringRight) return;
  if (ringLeft === stone) return;

  const stoneReg = q.regions[stone];
  const ringReg = q.regions[ringLeft];
  if (stoneReg.capstone >= 0 || ringReg.capstone >= 0) return;

  const ratio = Math.trunc(stoneReg.count * 100 / ringReg.count);
  if (ratio < 10 || ratio > 70) return;

  recordCapstone(q, ringLeft, stone);
}

function finderScan(q, y) {
  const px = q.pixels;
  const row = y * q.w;
  let lastColor = 0;
  let runLength = 0;
  let runCount = 0;
  const pb = [0, 0, 0, 0, 0];
  const check = [1, 1, 3, 1, 1];

  for (let x = 0; x < q.w; x++) {
    const color = px[row + x] ? 1 : 0;
    if (x && color !== lastColor) {
      pb.shift();
      pb.push(runLength);
      runLength = 0;
      runCount++;

      if (!color && runCount >= 5) {
        const scale = 16;
        const avg = Math.trunc((pb[0] + pb[1] + pb[3] + pb[4]) * scale / 4);
        const err = Math.trunc(avg * 3 / 4);
        let ok = 1;
        for (let i = 0; i < 5; i++) {
          if (pb[i] * scale < check[i] * avg - err || pb[i] * scale > check[i] * avg + err) ok = 0;
        }
        if (ok) testCapstone(q, x, y, pb);
      }
    }
    runLength++;
    lastColor = color;
  }
}

// Locate a single alignment pattern near qr.align (quirc's one-pattern search).
function findAlignmentPattern(q, index) {
  const qr = q.grids[index];
  const c0 = q.capstones[qr.caps[0]];
  const c2 = q.capstones[qr.caps[2]];
  const b = { x: qr.align.x, y: qr.align.y };

  let uv = perspectiveUnmap(c0.c, b);
  const a = perspectiveMap(c0.c, uv.u, uv.v + 1.0);
  uv = perspectiveUnmap(c2.c, b);
  const c = perspectiveMap(c2.c, uv.u + 1.0, uv.v);

  const sizeEstimate = Math.abs((a.x - b.x) * -(c.y - b.y) + (a.y - b.y) * (c.x - b.x));

  let stepSize = 1;
  let dir = 0;
  const dxMap = [1, 0, -1, 0];
  const dyMap = [0, -1, 0, 1];

  while (stepSize * stepSize < sizeEstimate * 100) {
    for (let i = 0; i < stepSize; i++) {
      const code = regionCode(q, b.x, b.y);
      if (code >= 0) {
        const reg = q.regions[code];
        if (reg.count >= sizeEstimate / 2 && reg.count <= sizeEstimate * 2) {
          qr.alignRegion = code;
          return;
        }
      }
      b.x += dxMap[dir];
      b.y += dyMap[dir];
    }
    dir = (dir + 1) % 4;
    if (!(dir & 1)) stepSize++;
  }
}

function measureGridSize(q, index) {
  const qr = q.grids[index];
  const a = q.capstones[qr.caps[0]];
  const b = q.capstones[qr.caps[1]];
  const c = q.capstones[qr.caps[2]];

  const ab = length(b.corners[0], a.corners[3]);
  const capAb = (length(b.corners[0], b.corners[3]) + length(a.corners[0], a.corners[3])) / 2.0;
  const verGrid = 7.0 * ab / capAb;

  const bc = length(b.corners[0], c.corners[1]);
  const capBc = (length(b.corners[0], b.corners[1]) + length(c.corners[0], c.corners[1])) / 2.0;
  const horGrid = 7.0 * bc / capBc;

  const est = (verGrid + horGrid) * 0.5;
  const ver = Math.trunc((est - (17.0 - 2.0)) * (1 / 4));
  qr.gridSize = 4 * ver + 17;
}

// --- perspective fitness scoring + jiggle (port of identify.c fitness_*) ---

function fitnessCell(q, qr, x, y) {
  const offsets = [0.3, 0.5, 0.7];
  let score = 0;
  for (let v = 0; v < 3; v++) {
    for (let u = 0; u < 3; u++) {
      const p = perspectiveMap(qr.c, x + offsets[u], y + offsets[v]);
      if (p.y < 0 || p.y >= q.h || p.x < 0 || p.x >= q.w) continue;
      if (q.pixels[p.y * q.w + p.x]) score++; else score--;
    }
  }
  return score;
}

function fitnessRing(q, qr, cx, cy, radius) {
  let score = 0;
  for (let i = 0; i < radius * 2; i++) {
    score += fitnessCell(q, qr, cx - radius + i, cy - radius);
    score += fitnessCell(q, qr, cx - radius, cy + radius - i);
    score += fitnessCell(q, qr, cx + radius, cy - radius + i);
    score += fitnessCell(q, qr, cx + radius - i, cy + radius);
  }
  return score;
}

function fitnessApat(q, qr, cx, cy) {
  return fitnessCell(q, qr, cx, cy) - fitnessRing(q, qr, cx, cy, 1) + fitnessRing(q, qr, cx, cy, 2);
}

function fitnessCapstone(q, qr, x, y) {
  x += 3;
  y += 3;
  return fitnessCell(q, qr, x, y) + fitnessRing(q, qr, x, y, 1) -
         fitnessRing(q, qr, x, y, 2) + fitnessRing(q, qr, x, y, 3);
}

function fitnessAll(q, index) {
  const qr = q.grids[index];
  const version = (qr.gridSize - 17) / 4;
  let score = 0;

  for (let i = 0; i < qr.gridSize - 14; i++) {
    const expect = (i & 1) ? 1 : -1;
    score += fitnessCell(q, qr, i + 7, 6) * expect;
    score += fitnessCell(q, qr, 6, i + 7) * expect;
  }

  score += fitnessCapstone(q, qr, 0, 0);
  score += fitnessCapstone(q, qr, qr.gridSize - 7, 0);
  score += fitnessCapstone(q, qr, 0, qr.gridSize - 7);

  if (version < 1 || version > 40) return score;
  const apat = VERSION_DB[version].apat;
  const apCount = apat.length;

  for (let i = 1; i + 1 < apCount; i++) {
    score += fitnessApat(q, qr, 6, apat[i]);
    score += fitnessApat(q, qr, apat[i], 6);
  }
  for (let i = 1; i < apCount; i++) {
    for (let j = 1; j < apCount; j++) {
      score += fitnessApat(q, qr, apat[i], apat[j]);
    }
  }
  return score;
}

function jigglePerspective(q, index) {
  const qr = q.grids[index];
  let best = fitnessAll(q, index);
  const adjustments = new Float64Array(8);
  for (let i = 0; i < 8; i++) adjustments[i] = qr.c[i] * 0.02;

  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < 16; i++) {
      const j = i >> 1;
      const old = qr.c[j];
      const step = adjustments[j];
      qr.c[j] = (i & 1) ? old + step : old - step;
      const test = fitnessAll(q, index);
      if (test > best) best = test;
      else qr.c[j] = old;
    }
    for (let i = 0; i < 8; i++) adjustments[i] *= 0.5;
  }
}

function setupQrPerspective(q, index) {
  const qr = q.grids[index];
  const rect = [
    { x: q.capstones[qr.caps[1]].corners[0].x, y: q.capstones[qr.caps[1]].corners[0].y },
    { x: q.capstones[qr.caps[2]].corners[0].x, y: q.capstones[qr.caps[2]].corners[0].y },
    { x: qr.align.x, y: qr.align.y },
    { x: q.capstones[qr.caps[0]].corners[0].x, y: q.capstones[qr.caps[0]].corners[0].y },
  ];
  qr.c = perspectiveSetup(rect, qr.gridSize - 7, qr.gridSize - 7);
  jigglePerspective(q, index);
}

function rotateCapstone(cap, h0, hd) {
  let best = 0;
  let bestScore = Infinity;
  for (let j = 0; j < 4; j++) {
    const p = cap.corners[j];
    const score = (p.x - h0.x) * -hd.y + (p.y - h0.y) * hd.x;
    if (!j || score < bestScore) {
      best = j;
      bestScore = score;
    }
  }
  const copy = [];
  for (let j = 0; j < 4; j++) {
    const src = cap.corners[(j + best) % 4];
    copy[j] = { x: src.x, y: src.y };
  }
  cap.corners = copy;
  cap.c = perspectiveSetup(cap.corners, 7.0, 7.0);
}

function recordQrGrid(q, a, b, c) {
  if (q.grids.length >= MAX_GRIDS) return;

  const h0 = { x: q.capstones[a].center.x, y: q.capstones[a].center.y };
  const hd = {
    x: q.capstones[c].center.x - q.capstones[a].center.x,
    y: q.capstones[c].center.y - q.capstones[a].center.y,
  };

  // Ensure A-B-C is clockwise; otherwise swap A and C.
  if ((q.capstones[b].center.x - h0.x) * -hd.y +
      (q.capstones[b].center.y - h0.y) * hd.x > 0) {
    const swap = a; a = c; c = swap;
    hd.x = -hd.x; hd.y = -hd.y;
  }

  const qrIndex = q.grids.length;
  const qr = { caps: [a, b, c], alignRegion: -1, align: { x: 0, y: 0 }, gridSize: 0, c: null };
  q.grids.push(qr);

  for (let i = 0; i < 3; i++) {
    const cap = q.capstones[qr.caps[i]];
    rotateCapstone(cap, h0, hd);
    cap.qrGrid = qrIndex;
  }

  measureGridSize(q, qrIndex);

  // Reject implausible grids early. Noise/clutter (hands, shadows) spawns many
  // false capstones whose geometry implies versions far outside 1..40; recording
  // them wastes huge time in jiggle/fitness over giant grid sizes (a source of
  // browser "page unresponsive" freezes) and they can never decode anyway.
  const gridVersion = (qr.gridSize - 17) / 4;
  if (gridVersion < 1 || gridVersion > 40 || !Number.isInteger(gridVersion)) {
    for (let i = 0; i < 3; i++) q.capstones[qr.caps[i]].qrGrid = -1;
    q.grids.pop();
    return;
  }

  const inter = lineIntersect(
    q.capstones[a].corners[0], q.capstones[a].corners[1],
    q.capstones[c].corners[0], q.capstones[c].corners[3]);
  if (!inter) {
    for (let i = 0; i < 3; i++) q.capstones[qr.caps[i]].qrGrid = -1;
    q.grids.pop();
    return;
  }
  qr.align.x = inter.x;
  qr.align.y = inter.y;

  if (qr.gridSize > 21) {
    findAlignmentPattern(q, qrIndex);
    if (qr.alignRegion >= 0) {
      const reg = q.regions[qr.alignRegion];
      qr.align.x = reg.seed.x;
      qr.align.y = reg.seed.y;

      const psd = {
        ref: { x: hd.x, y: hd.y },
        corners: [qr.align],
        scores: [-hd.y * qr.align.x + hd.x * qr.align.y],
      };

      floodFillSeed(q, reg.seed.x, reg.seed.y, qr.alignRegion, PIXEL_BLACK, null);
      floodFillSeed(q, reg.seed.x, reg.seed.y, PIXEL_BLACK, qr.alignRegion,
        (y, l, r) => findLeftmostToLine(psd, y, l, r));
    }
  }

  setupQrPerspective(q, qrIndex);
}

function testNeighbours(q, i, hlist, vlist) {
  for (let j = 0; j < hlist.length; j++) {
    const hn = hlist[j];
    for (let k = 0; k < vlist.length; k++) {
      const vn = vlist[k];
      const squareness = Math.abs(1.0 - hn.distance / vn.distance);
      if (squareness < 0.2) recordQrGrid(q, hn.index, i, vn.index);
    }
  }
}

function testGrouping(q, i) {
  const c1 = q.capstones[i];
  const hlist = [];
  const vlist = [];

  for (let j = 0; j < q.capstones.length; j++) {
    if (i === j) continue;
    const c2 = q.capstones[j];
    const { u, v } = perspectiveUnmap(c1.c, c2.center);
    const uu = Math.abs(u - 3.5);
    const vv = Math.abs(v - 3.5);

    if (uu < 0.2 * vv) hlist.push({ index: j, distance: vv });
    if (vv < 0.2 * uu) vlist.push({ index: j, distance: uu });
  }

  if (!(hlist.length && vlist.length)) return;
  testNeighbours(q, i, hlist, vlist);
}

// Run full detection: locate capstones row by row, then group them into grids.
export function detect(q) {
  for (let y = 0; y < q.h; y++) finderScan(q, y);
  const n = q.capstones.length;
  for (let i = 0; i < n; i++) testGrouping(q, i);
}
