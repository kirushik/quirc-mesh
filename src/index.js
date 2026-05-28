// quirc-mesh public API.
//
//   import { decode } from "quirc-mesh";
//   const result = decode(imageData);   // imageData: {data, width, height} (RGBA/gray)
//   // -> { text, bytes, version, ecLevel, mask, dataType, eci, corners } or null
//
// Returns null on any failure (no decode, RS failure, etc.) — fail-closed: never
// a confidently-wrong payload (PRD AC-4). RS + format BCH guarantee this.

import { toGray, otsu, binarizeGlobal, binarizeAdaptive } from "./binarize.js";
import { detect, jigglePerspective } from "./finder.js";
import { extractCode, extractCodeMesh } from "./sample.js";
import { buildControlGrid } from "./alignment.js";
import { buildMesh } from "./mesh.js";
import { refineVersion } from "./version_info.js";
import { decodeCode } from "./decode.js";
import { ECC_LETTER } from "./version_db.js";
import { ERR } from "./errors.js";

const utf8 = new TextDecoder("utf-8", { fatal: false });

// Loosened grouping (finder.js) admits more candidate grids per frame. Each grid
// costs an expensive mesh sample, so we try them best-first by the jiggle fitness
// the detector already computed (the real code dominates bogus clutter grids) and
// cap the number of full decode attempts — bounding worst-case time on noisy
// close-up frames without sacrificing the real read (it is almost always rank 1).
const MAX_DECODE_ATTEMPTS = 10;

function gridsByFitness(q) {
  return q.grids.map((_, i) => i).sort((a, b) => (q.grids[b].fitness || 0) - (q.grids[a].fitness || 0));
}

function flipCode(code) {
  const size = code.size;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (code.cells[x * size + y]) out[y * size + x] = 1;
    }
  }
  return { size, cells: out, corners: code.corners };
}

function buildResult(data, corners) {
  const bytes = data.payload.slice(0, data.payloadLen);
  return {
    text: utf8.decode(bytes),
    bytes,
    version: data.version,
    ecLevel: ECC_LETTER[data.eccLevel],
    mask: data.mask,
    dataType: data.dataType,
    eci: data.eci,
    corners,
  };
}

// Build the binarized detector state for an image. `adaptive` selects the local
// block-based binarizer (camera path); default is global Otsu (exact on clean PNGs).
function buildState(image, adaptive) {
  const gray = toGray(image);
  const w = image.width, h = image.height;
  const pixels = adaptive ? binarizeAdaptive(gray, w, h) : binarizeGlobal(gray, otsu(gray));
  return { w, h, pixels, regions: [null, null], capstones: [], grids: [] };
}

// Extract a grid's matrix, preferring the mesh sampler (falls back to the single
// global homography for v<2 or when no control grid can be built).
function extractGrid(q, index, useMesh) {
  const qr = q.grids[index];
  // Jiggle is deferred here from detect() so only attempted grids pay for it.
  jigglePerspective(q, index);
  // Pin the true version from the version-info blocks (v>=7); corrects gridSize +
  // perspective when measure_grid_size drifted under distortion.
  refineVersion(q, qr);
  if (useMesh) {
    const control = buildControlGrid(q, qr);
    if (control) return extractCodeMesh(q, qr, buildMesh(control));
  }
  return extractCode(q, index);
}

function tryDecode(code) {
  let { err, data } = decodeCode(code);
  if (err === ERR.SUCCESS) return data;
  // Retry mirrored (ISO 18004:2015 optional mirror feature).
  ({ err, data } = decodeCode(flipCode(code)));
  return err === ERR.SUCCESS ? data : null;
}

// Decode the first readable QR code in the image. Returns a result object or null.
// opts.mesh (default true): use piecewise mesh sampling; false = single homography.
export function decode(image, opts = {}) {
  const useMesh = opts.mesh !== false;
  const q = buildState(image, opts.adaptive === true);
  detect(q);

  const order = gridsByFitness(q);
  for (let n = 0; n < order.length && n < MAX_DECODE_ATTEMPTS; n++) {
    const code = extractGrid(q, order[n], useMesh);
    const data = tryDecode(code);
    if (data) return buildResult(data, code.corners);
  }
  return null;
}

// Decode all readable codes in the image (returns an array, possibly empty).
export function decodeAll(image, opts = {}) {
  const useMesh = opts.mesh !== false;
  const q = buildState(image, opts.adaptive === true);
  detect(q);

  const results = [];
  const order = gridsByFitness(q);
  for (let n = 0; n < order.length && n < MAX_DECODE_ATTEMPTS; n++) {
    const code = extractGrid(q, order[n], useMesh);
    const data = tryDecode(code);
    if (data) results.push(buildResult(data, code.corners));
  }
  return results;
}

// Like decode(), but also returns detection diagnostics — so a camera failure can
// be attributed to detection (no capstones/grids) vs sampling (grid found, no decode).
export function decodeDebug(image, opts = {}) {
  const useMesh = opts.mesh !== false;
  const q = buildState(image, opts.adaptive === true);
  detect(q);

  let result = null;
  const order = gridsByFitness(q);
  for (let n = 0; n < order.length && n < MAX_DECODE_ATTEMPTS; n++) {
    const code = extractGrid(q, order[n], useMesh);
    const data = tryDecode(code);
    if (data) { result = buildResult(data, code.corners); break; }
  }
  return {
    result,
    capstones: q.capstones.length,
    grids: q.grids.map((g) => ({ version: (g.gridSize - 17) / 4, gridSize: g.gridSize })),
  };
}

export default { decode, decodeAll, decodeDebug };
