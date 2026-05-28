// Bit-matrix extraction from a located grid.
//
// M1: sample every module through the grid's single global perspective transform
// (port of quirc identify.c read_cell + quirc_extract). M2 will add a mesh-based
// extractor here; the output shape (a `code` object) stays identical so decode.js
// is unaffected.

import { perspectiveMap } from "./perspective.js";

// Read one cell via the global transform. +1 black, -1 white, 0 out-of-bounds.
function readCell(q, qr, x, y) {
  const p = perspectiveMap(qr.c, x + 0.5, y + 0.5);
  if (p.y < 0 || p.y >= q.h || p.x < 0 || p.x >= q.w) return 0;
  return q.pixels[p.y * q.w + p.x] ? 1 : -1;
}

// Extract the full module matrix for grid `index`.
// Returns { size, cells:Uint8Array(size*size) (1=black,0=white), corners:[4]{x,y} }.
export function extractCode(q, index) {
  const qr = q.grids[index];
  const size = qr.gridSize;
  const corners = [
    perspectiveMap(qr.c, 0.0, 0.0),
    perspectiveMap(qr.c, size, 0.0),
    perspectiveMap(qr.c, size, size),
    perspectiveMap(qr.c, 0.0, size),
  ];

  const cells = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (readCell(q, qr, x, y) > 0) cells[y * size + x] = 1;
    }
  }
  return { size, cells, corners };
}

// Cell accessor for decode.js (mirrors quirc grid_bit).
export function gridBit(code, x, y) {
  return code.cells[y * code.size + x];
}
