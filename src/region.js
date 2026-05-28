// Connected-component region labeling via span-based flood fill.
// Port of quirc identify.c: flood_fill_*, region_code, find_region_corners and
// the polygon-score span callbacks. All functions operate on a shared state `q`:
//   { w, h, pixels:Uint8Array, regions:[], capstones:[], grids:[] }
// pixels holds 0=WHITE, 1=BLACK, >=2 = region label (== index into regions[]).

import { PIXEL_WHITE, PIXEL_BLACK, PIXEL_REGION } from "./binarize.js";

// Region numbering starts at PIXEL_REGION (2). With a uint16 label buffer (see
// binarize.js) we allow up to 65534 regions — necessary because dense v30-v40
// codes blow past quirc's default 254-region cap, which otherwise makes the third
// finder undetectable.
export const MAX_REGIONS = 65534;

// Fill the horizontal run of `from` pixels containing x on row y, recolour to
// `to`, invoke spanFunc(y,left,right) if given, return {left,right}.
function floodFillLine(q, x, y, from, to, spanFunc) {
  const px = q.pixels;
  const row = y * q.w;
  let left = x, right = x;
  while (left > 0 && px[row + left - 1] === from) left--;
  while (right < q.w - 1 && px[row + right + 1] === from) right++;
  for (let i = left; i <= right; i++) px[row + i] = to;
  if (spanFunc) spanFunc(y, left, right);
  return { left, right };
}

function getFrame(stack, idx) {
  let f = stack[idx];
  if (!f) { f = { y: 0, right: 0, leftUp: 0, leftDown: 0 }; stack[idx] = f; }
  return f;
}

// Scan the row adjacent to frame `vars` (in `direction`) for a connected run of
// `from`; on the first hit, push a new frame for it and return its index, else -1.
function callNext(q, from, to, spanFunc, stack, varsIdx, direction) {
  const vars = stack[varsIdx];
  const rowY = vars.y + direction;
  const rowOff = rowY * q.w;
  const px = q.pixels;

  let lp = direction < 0 ? vars.leftUp : vars.leftDown;
  while (lp <= vars.right) {
    if (px[rowOff + lp] === from) {
      // Leave the cursor pointing at the hit (matches quirc: it self-corrects on
      // resume because the pixel is now `to`).
      if (direction < 0) vars.leftUp = lp; else vars.leftDown = lp;
      const nvIdx = varsIdx + 1;
      const nv = getFrame(stack, nvIdx);
      nv.y = rowY;
      const r = floodFillLine(q, lp, rowY, from, to, spanFunc);
      nv.right = r.right;
      nv.leftDown = r.left;
      nv.leftUp = r.left;
      return nvIdx;
    }
    lp++;
  }
  if (direction < 0) vars.leftUp = lp; else vars.leftDown = lp;
  return -1;
}

export function floodFillSeed(q, x0, y0, from, to, spanFunc) {
  if (from === to) return;
  const stack = (q._ffStack ||= []);

  let sp = 0;
  const first = getFrame(stack, 0);
  first.y = y0;
  const r = floodFillLine(q, x0, y0, from, to, spanFunc);
  first.right = r.right;
  first.leftDown = r.left;
  first.leftUp = r.left;

  for (;;) {
    const vars = stack[sp];
    let advanced = false;

    if (vars.y > 0) {
      const nv = callNext(q, from, to, spanFunc, stack, sp, -1);
      if (nv >= 0) { sp = nv; advanced = true; }
    }
    if (!advanced && vars.y < q.h - 1) {
      const nv = callNext(q, from, to, spanFunc, stack, sp, 1);
      if (nv >= 0) { sp = nv; advanced = true; }
    }
    if (advanced) continue;
    if (sp > 0) { sp--; continue; }
    break;
  }
}

// Return the region label at (x,y), creating + flood-filling a new region if the
// pixel is BLACK and unlabeled. Returns -1 for out-of-bounds/white/region-cap.
export function regionCode(q, x, y) {
  if (x < 0 || y < 0 || x >= q.w || y >= q.h) return -1;

  const pixel = q.pixels[y * q.w + x];
  if (pixel >= PIXEL_REGION) return pixel;
  if (pixel === PIXEL_WHITE) return -1;

  if (q.regions.length >= MAX_REGIONS) return -1;

  const region = q.regions.length;
  const box = { seed: { x, y }, count: 0, capstone: -1 };
  q.regions.push(box);

  floodFillSeed(q, x, y, pixel, region, (y2, l, r) => { box.count += r - l + 1; });
  return region;
}

// --- polygon corner-finding span callbacks (operate on a psd context) ---

function findOneCorner(psd, y, left, right) {
  const xs = [left, right];
  const dy = y - psd.ref.y;
  for (let i = 0; i < 2; i++) {
    const dx = xs[i] - psd.ref.x;
    const d = dx * dx + dy * dy;
    if (d > psd.scores[0]) {
      psd.scores[0] = d;
      psd.corners[0].x = xs[i];
      psd.corners[0].y = y;
    }
  }
}

function findOtherCorners(psd, y, left, right) {
  const xs = [left, right];
  for (let i = 0; i < 2; i++) {
    const up = xs[i] * psd.ref.x + y * psd.ref.y;
    const right2 = xs[i] * -psd.ref.y + y * psd.ref.x;
    const scores = [up, right2, -up, -right2];
    for (let j = 0; j < 4; j++) {
      if (scores[j] > psd.scores[j]) {
        psd.scores[j] = scores[j];
        psd.corners[j].x = xs[i];
        psd.corners[j].y = y;
      }
    }
  }
}

// Find the 4 corners of region `rcode` relative to reference point `ref`,
// writing into `corners` (array of 4 mutable {x,y}). Port of find_region_corners.
export function findRegionCorners(q, rcode, ref, corners) {
  const region = q.regions[rcode];
  const psd = { ref: { x: ref.x, y: ref.y }, scores: [-1, 0, 0, 0], corners };

  floodFillSeed(q, region.seed.x, region.seed.y, rcode, PIXEL_BLACK,
    (y, l, r) => findOneCorner(psd, y, l, r));

  psd.ref.x = psd.corners[0].x - psd.ref.x;
  psd.ref.y = psd.corners[0].y - psd.ref.y;

  for (let i = 0; i < 4; i++) {
    corners[i].x = region.seed.x;
    corners[i].y = region.seed.y;
  }

  let i = region.seed.x * psd.ref.x + region.seed.y * psd.ref.y;
  psd.scores[0] = i;
  psd.scores[2] = -i;
  i = region.seed.x * -psd.ref.y + region.seed.y * psd.ref.x;
  psd.scores[1] = i;
  psd.scores[3] = -i;

  floodFillSeed(q, region.seed.x, region.seed.y, PIXEL_BLACK, rcode,
    (y, l, r) => findOtherCorners(psd, y, l, r));
}

// Span callback used to find the alignment-pattern point closest to the grid's
// top-left, along reference line `ref`. Exposed for finder.js / alignment.js.
export function findLeftmostToLine(psd, y, left, right) {
  const xs = [left, right];
  for (let i = 0; i < 2; i++) {
    const d = -psd.ref.y * xs[i] + psd.ref.x * y;
    if (d < psd.scores[0]) {
      psd.scores[0] = d;
      psd.corners[0].x = xs[i];
      psd.corners[0].y = y;
    }
  }
}
