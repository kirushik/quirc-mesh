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

// Extract the module matrix via a sampling mesh (M2). Each module is decided by a
// 3x3 vote of sub-module samples mapped through the local mesh cell, for noise
// immunity. `mesh` has map(gx,gy)->{x,y}; `qr` provides gridSize.
const VOTE = [0.3, 0.5, 0.7];
export function extractCodeMesh(q, qr, mesh) {
  const size = qr.gridSize;
  const cells = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dark = 0;
      for (let v = 0; v < 3; v++) {
        for (let u = 0; u < 3; u++) {
          const p = mesh.map(x + VOTE[u], y + VOTE[v]);
          const xi = Math.round(p.x), yi = Math.round(p.y);
          if (xi >= 0 && yi >= 0 && xi < q.w && yi < q.h && q.pixels[yi * q.w + xi]) dark++;
        }
      }
      if (dark >= 5) cells[y * size + x] = 1;
    }
  }
  const corners = [
    mesh.map(0, 0), mesh.map(size, 0), mesh.map(size, size), mesh.map(0, size),
  ];
  return { size, cells, corners };
}

// Cell accessor for decode.js (mirrors quirc grid_bit).
export function gridBit(code, x, y) {
  return code.cells[y * code.size + x];
}
