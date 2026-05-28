// Sweep the two grouping tolerances (axis classification + squareness) against the
// raw detection rate on the distorted corpus, to find where detection stops being
// the bottleneck. Binarize each image once (tolerances don't affect binarization);
// clone the label buffer per run since detect() relabels in place.
//
//   node harness/sweep-detect.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VEC = path.join(ROOT, "test-vectors");
const OUT = path.join(VEC, "distorted");

const req = createRequire(path.join(ROOT, "x.js"));
const { PNG } = await import(pathToFileURL(req.resolve("pngjs")));
const { toGray, binarizeAdaptive } = await import(pathToFileURL(path.join(ROOT, "src/binarize.js")));
const { detect } = await import(pathToFileURL(path.join(ROOT, "src/finder.js")));

const index = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"));

// Pre-binarize once.
const imgs = index.map((item) => {
  const png = PNG.sync.read(fs.readFileSync(path.join(VEC, item.file)));
  const img = { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  const pixels = binarizeAdaptive(toGray(img), img.width, img.height);
  return { item, w: img.width, h: img.height, pixels };
});

function detRate(axisTol, squareTol) {
  let det = 0, grids = 0;
  const t0 = performance.now();
  for (const im of imgs) {
    const q = { w: im.w, h: im.h, pixels: im.pixels.slice(),
      regions: [null, null], capstones: [], grids: [], _axisTol: axisTol, _squareTol: squareTol };
    detect(q);
    if (q.grids.length > 0) det++;
    grids += q.grids.length;
  }
  return { det, grids, ms: performance.now() - t0 };
}

const axisVals = [0.2, 0.3, 0.4, 0.5];
const sqVals = [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0];

const pad = (s, n) => String(s).padEnd(n);
console.log(`detection rate / ${imgs.length}  (rows = axisTol, cols = squareTol)\n`);
console.log(pad("axis\\sq", 9) + sqVals.map((s) => pad(s, 8)).join(""));
for (const a of axisVals) {
  const cells = sqVals.map((s) => { const r = detRate(a, s); return pad(`${r.det}`, 8); });
  console.log(pad(a, 9) + cells.join(""));
}

console.log("\ngrids created (proxy for runtime cost):\n");
console.log(pad("axis\\sq", 9) + sqVals.map((s) => pad(s, 8)).join(""));
for (const a of axisVals) {
  const cells = sqVals.map((s) => { const r = detRate(a, s); return pad(`${r.grids}`, 8); });
  console.log(pad(a, 9) + cells.join(""));
}
