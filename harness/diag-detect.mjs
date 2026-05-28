// Detection diagnostics: run detect() with q._diag over the distorted corpus and
// attribute failures to a pipeline stage (capstones / grouping / squareness /
// version-reject / no-intersection). For high-version frames that find 3 capstones
// but no grid, dump the raw grouping geometry so we can see how far the rejected
// pairs sit from the thresholds.
//
//   node harness/gen-distorted.mjs   # once
//   node harness/diag-detect.mjs [--detail]

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VEC = path.join(ROOT, "test-vectors");
const OUT = path.join(VEC, "distorted");
const DETAIL = process.argv.includes("--detail");

const req = createRequire(path.join(ROOT, "x.js"));
const { PNG } = await import(pathToFileURL(req.resolve("pngjs")));
const { toGray, otsu, binarizeGlobal, binarizeAdaptive } = await import(pathToFileURL(path.join(ROOT, "src/binarize.js")));
const { detect } = await import(pathToFileURL(path.join(ROOT, "src/finder.js")));

const index = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"));

function run(img, adaptive) {
  const gray = toGray(img);
  const pixels = adaptive ? binarizeAdaptive(gray, img.width, img.height)
                          : binarizeGlobal(gray, otsu(gray));
  const q = { w: img.width, h: img.height, pixels, regions: [null, null], capstones: [], grids: [], _diag: {} };
  detect(q);
  return q;
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("vector", 40), pad("caps", 5), pad("pair?", 6), pad("sq+/-", 8),
  pad("rejV", 5), pad("rejI", 5), pad("grids", 6));

const detailCases = [];
for (const item of index) {
  const png = PNG.sync.read(fs.readFileSync(path.join(VEC, item.file)));
  const img = { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  const q = run(img, true);
  const d = q._diag;
  const both = d.grouping_both || 0, nopair = d.grouping_nopair || 0;
  const sp = d.square_pass || 0, sf = d.square_fail || 0;
  console.log(
    pad(path.basename(item.file), 40),
    pad(q.capstones.length, 5),
    pad(`${both}/${both + nopair}`, 6),
    pad(`${sp}/${sf}`, 8),
    pad(d.reject_version || 0, 5),
    pad(d.reject_no_inter || 0, 5),
    pad(q.grids.length, 6),
  );
  if (q.capstones.length >= 3 && q.grids.length === 0) detailCases.push({ item, d });
}

if (DETAIL) {
  console.log("\n=== detail: 3+ capstones but NO grid recorded ===");
  for (const { item, d } of detailCases) {
    console.log(`\n${path.basename(item.file)}  (v${item.version})`);
    const uv = d.pair_uv || [];
    // For each ordered pair, show how cleanly it classifies as h (uu<<vv) or v (vv<<uu).
    for (const p of uv) {
      const hRatio = p.uu / (p.vv || 1e-9); // < 0.2 => horizontal neighbour
      const vRatio = p.vv / (p.uu || 1e-9); // < 0.2 => vertical neighbour
      const tag = hRatio < 0.2 ? "H" : vRatio < 0.2 ? "V" : "-";
      console.log(`   pair ${p.i}->${p.j}: uu=${p.uu.toFixed(2)} vv=${p.vv.toFixed(2)}  h=${hRatio.toFixed(3)} v=${vRatio.toFixed(3)}  [${tag}]`);
    }
    const sq = d.squareness || [];
    if (sq.length) console.log(`   squareness: ${sq.map((s) => s.toFixed(3)).join(", ")}  (pass if <0.2)`);
    if (d.recorded_version) console.log(`   recorded_version candidates: ${d.recorded_version.join(", ")}`);
  }
}
