// Piecewise sampling mesh (ALGORITHM.md Option A: per-cell bilinear).
//
// Given the N x N control grid of alignment/finder pixel positions (built by
// alignment.js), map any continuous grid coordinate (gx,gy) to a pixel by
// bilinear interpolation within the enclosing cell of alignment-coordinate lines.
// Border modules (outside the outer alignment lines) extrapolate from the nearest
// cell — this tracks local lens/paper distortion a single homography cannot.

export function buildMesh(control) {
  const { nodeGX, nodeGY, grid, N } = control;

  function cellIndex(coords, g) {
    let i = 0;
    while (i < N - 2 && g >= coords[i + 1]) i++;
    return i;
  }

  function map(gx, gy) {
    const i = cellIndex(nodeGX, gx);
    const j = cellIndex(nodeGY, gy);
    const x0 = nodeGX[i], x1 = nodeGX[i + 1];
    const y0 = nodeGY[j], y1 = nodeGY[j + 1];
    const tx = (gx - x0) / (x1 - x0);
    const ty = (gy - y0) / (y1 - y0);

    const P00 = grid[j][i], P10 = grid[j][i + 1];
    const P01 = grid[j + 1][i], P11 = grid[j + 1][i + 1];

    const topX = P00.x + (P10.x - P00.x) * tx;
    const topY = P00.y + (P10.y - P00.y) * tx;
    const botX = P01.x + (P11.x - P01.x) * tx;
    const botY = P01.y + (P11.y - P01.y) * tx;

    return { x: topX + (botX - topX) * ty, y: topY + (botY - topY) * ty };
  }

  return { map };
}
