// Locate ALL alignment patterns to build the control-point grid for mesh sampling.
//
// The control grid is the version's apat x apat grid (N x N). Its three corners
// (0,0),(N-1,0),(0,N-1) always coincide with the three finder patterns (because
// apat[N-1] == gridSize-7), so we take those control points from the finders'
// own 7x7 perspectives. The remaining N*N-3 nodes are alignment-pattern centers
// located in the image (the bottom-right (N-1,N-1) and all interior ones).
// Missing patterns (glare/damage) are filled by the parallelogram rule, then by
// the coarse global transform as a last resort.

import { perspectiveMapF } from "./perspective.js";
import { VERSION_DB } from "./version_db.js";

function isDark(q, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= q.w || yi >= q.h) return 0;
  return q.pixels[yi * q.w + xi] ? 1 : 0;
}

// Module size in pixels near grid coord (gx,gy) under the coarse transform.
function moduleSizePx(qr, gx, gy) {
  const a = perspectiveMapF(qr.c, gx, gy);
  const b = perspectiveMapF(qr.c, gx + 1, gy);
  const c = perspectiveMapF(qr.c, gx, gy + 1);
  return (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 2;
}

// Score how well a 5x5 concentric alignment pattern sits at pixel (cx,cy):
// center dark, the 8 ring-1 neighbours light, the 8 ring-2 neighbours dark. Max 17.
const RING1 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const RING2 = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2]];
function scoreApat(q, cx, cy, m) {
  let score = isDark(q, cx, cy) ? 1 : 0;
  for (const [dx, dy] of RING1) if (!isDark(q, cx + dx * m, cy + dy * m)) score++;
  for (const [dx, dy] of RING2) if (isDark(q, cx + dx * m, cy + dy * m)) score++;
  return score;
}

// Search a window around (ex,ey) for the alignment pattern center; refine to the
// dark-blob centroid. Returns {x,y} or null if no convincing pattern is found.
function locateApat(q, ex, ey, m) {
  const win = Math.max(2, Math.round(m * 2));
  let best = -1, bx = ex, by = ey;
  for (let dy = -win; dy <= win; dy++) {
    for (let dx = -win; dx <= win; dx++) {
      const s = scoreApat(q, ex + dx, ey + dy, m);
      if (s > best) { best = s; bx = ex + dx; by = ey + dy; }
    }
  }
  if (best < 14) return null; // out of 17

  // Sub-pixel: centroid of the dark center module (within ~0.7 module radius).
  const r = Math.max(1, Math.round(m * 0.7));
  let sx = 0, sy = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const xi = Math.round(bx + dx), yi = Math.round(by + dy);
      if (xi < 0 || yi < 0 || xi >= q.w || yi >= q.h) continue;
      if (q.pixels[yi * q.w + xi]) { sx += xi; sy += yi; n++; }
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n } : { x: bx, y: by };
}

// Build the N x N control-point grid (pixel positions of each module center) plus
// metadata. Returns null if the version has too few alignment lines for a mesh.
export function buildControlGrid(q, qr) {
  const version = (qr.gridSize - 17) / 4;
  if (version < 2) return null;
  const apat = VERSION_DB[version].apat;
  const N = apat.length;
  if (N < 2) return null;

  const nodeGX = apat.map((a) => a + 0.5);
  const nodeGY = apat.map((a) => a + 0.5);
  const grid = Array.from({ length: N }, () => new Array(N).fill(null));

  // Three finder corners from the finders' own perspectives (grid[row][col]).
  const TL = q.capstones[qr.caps[1]].c; // top-left
  const TR = q.capstones[qr.caps[2]].c; // top-right
  const BL = q.capstones[qr.caps[0]].c; // bottom-left
  grid[0][0] = perspectiveMapF(TL, 6.5, 6.5);
  grid[0][N - 1] = perspectiveMapF(TR, 0.5, 6.5);
  grid[N - 1][0] = perspectiveMapF(BL, 6.5, 0.5);

  // Locate every other node (interior + bottom-right) by image search.
  let found = 0, total = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if ((i === 0 && j === 0) || (i === N - 1 && j === 0) || (i === 0 && j === N - 1)) continue;
      total++;
      const gx = apat[i] + 0.5, gy = apat[j] + 0.5;
      const e = perspectiveMapF(qr.c, gx, gy);
      const m = moduleSizePx(qr, apat[i], apat[j]);
      const p = locateApat(q, e.x, e.y, m);
      if (p) { grid[j][i] = p; found++; }
    }
  }

  fillMissing(grid, N, qr, apat);

  return { apat, nodeGX, nodeGY, grid, N, coverage: total ? found / total : 1 };
}

// Fill null nodes: parallelogram rule from known neighbours (several passes),
// then the coarse global transform as a last resort so the mesh is always complete.
function fillMissing(grid, N, qr, apat) {
  const combos = [
    [[-1, 0], [0, -1], [-1, -1]],
    [[1, 0], [0, -1], [1, -1]],
    [[-1, 0], [0, 1], [-1, 1]],
    [[1, 0], [0, 1], [1, 1]],
  ];
  for (let pass = 0; pass < N; pass++) {
    let changed = false;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (grid[j][i]) continue;
        for (const [[ax, ay], [bx, by], [cx, cy]] of combos) {
          const A = at(grid, N, i + ax, j + ay);
          const B = at(grid, N, i + bx, j + by);
          const C = at(grid, N, i + cx, j + cy);
          if (A && B && C) {
            grid[j][i] = { x: A.x + B.x - C.x, y: A.y + B.y - C.y };
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!grid[j][i]) grid[j][i] = perspectiveMapF(qr.c, apat[i] + 0.5, apat[j] + 0.5);
    }
  }
}

function at(grid, N, i, j) {
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  return grid[j][i];
}
