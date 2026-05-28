// Deterministic proof: a grid whose perspective implies a huge module size makes
// buildControlGrid -> locateApat scan a giant window per alignment pattern.
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const { perspectiveSetup } = await import(pathToFileURL(path.join(ROOT, "src/perspective.js")));
const { buildControlGrid } = await import(pathToFileURL(path.join(ROOT, "src/alignment.js")));

const w = 300, h = 300, pixels = new Uint16Array(w * h); // blank (white)
const q = { w, h, pixels, regions: [], capstones: [], grids: [] };

for (const [v, gs] of [[10, 57], [12, 65]]) {
  for (const M of [6, 120, 300]) {        // px per module: sane, big, degenerate
    const span = gs - 7;
    const rect = [{ x: 0, y: 0 }, { x: span * M, y: 0 }, { x: span * M, y: span * M }, { x: 0, y: span * M }];
    const c = perspectiveSetup(rect, span, span);
    const qr = { gridSize: gs, c, align: { x: 0, y: 0 }, caps: [0, 1, 2], capSnap: [{ c }, { c }, { c }] };
    const t0 = performance.now();
    buildControlGrid(q, qr);
    console.log(`v${v} m=${M}px -> buildControlGrid ${(performance.now() - t0).toFixed(0)}ms`);
  }
}
