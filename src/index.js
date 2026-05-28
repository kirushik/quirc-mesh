// quirc-mesh public API.
//
//   import { decode } from "quirc-mesh";
//   const result = decode(imageData);   // imageData: {data, width, height} (RGBA/gray)
//   // -> { text, bytes, version, ecLevel, mask, dataType, eci, corners } or null
//
// Returns null on any failure (no decode, RS failure, etc.) — fail-closed: never
// a confidently-wrong payload (PRD AC-4). RS + format BCH guarantee this.

import { toGray, otsu, binarizeGlobal } from "./binarize.js";
import { detect } from "./finder.js";
import { extractCode } from "./sample.js";
import { decodeCode } from "./decode.js";
import { ECC_LETTER } from "./version_db.js";
import { ERR } from "./errors.js";

const utf8 = new TextDecoder("utf-8", { fatal: false });

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

// Build the binarized detector state for an image (global Otsu — M1 path).
function buildState(image) {
  const gray = toGray(image);
  const w = image.width, h = image.height;
  const threshold = otsu(gray);
  const pixels = binarizeGlobal(gray, threshold);
  return { w, h, pixels, regions: [null, null], capstones: [], grids: [], threshold };
}

// Decode the first readable QR code in the image. Returns a result object or null.
export function decode(image) {
  const q = buildState(image);
  detect(q);

  for (let i = 0; i < q.grids.length; i++) {
    const code = extractCode(q, i);

    let { err, data } = decodeCode(code);
    if (err === ERR.SUCCESS) return buildResult(data, code.corners);

    // Retry mirrored (ISO 18004:2015 optional mirror feature).
    ({ err, data } = decodeCode(flipCode(code)));
    if (err === ERR.SUCCESS) return buildResult(data, code.corners);
  }
  return null;
}

// Decode all readable codes in the image (returns an array, possibly empty).
export function decodeAll(image) {
  const q = buildState(image);
  detect(q);

  const results = [];
  for (let i = 0; i < q.grids.length; i++) {
    const code = extractCode(q, i);
    let { err, data } = decodeCode(code);
    if (err !== ERR.SUCCESS) ({ err, data } = decodeCode(flipCode(code)));
    if (err === ERR.SUCCESS) results.push(buildResult(data, code.corners));
  }
  return results;
}

export default { decode, decodeAll };
