// Synthetic-distortion harness: decode the degraded vectors and compare the
// single-homography baseline against the mesh sampler (with and without the local
// adaptive binarizer), plus the raw detection rate.
//
//   node harness/gen-distorted.mjs   # once, to (re)generate vectors
//   node harness/run-synth.mjs
//
// Core thesis: mesh should succeed on distorted high-version codes where
// single-homography fails. "det" shows how often detection even finds a grid —
// when det fails, no sampler can help (that gap is the detection-robustness work).

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
const { decode } = await import(pathToFileURL(path.join(ROOT, "src/index.js")));
const { toGray, otsu, binarizeGlobal, binarizeAdaptive } = await import(pathToFileURL(path.join(ROOT, "src/binarize.js")));
const { detect } = await import(pathToFileURL(path.join(ROOT, "src/finder.js")));

const indexFile = path.join(OUT, "index.json");
if (!fs.existsSync(indexFile)) {
  console.error("No distorted vectors. Run: node harness/gen-distorted.mjs");
  process.exit(2);
}
const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));

const CONFIGS = [
  ["single", { mesh: false, adaptive: false }],
  ["mesh", { mesh: true, adaptive: false }],
  ["mesh+adp", { mesh: true, adaptive: true }],
];

function detected(img, adaptive) {
  const gray = toGray(img);
  const pixels = adaptive ? binarizeAdaptive(gray, img.width, img.height)
                          : binarizeGlobal(gray, otsu(gray));
  const q = { w: img.width, h: img.height, pixels, regions: [null, null], capstones: [], grids: [] };
  detect(q);
  return q.grids.length > 0;
}

const groups = {};
for (const item of index) {
  const png = PNG.sync.read(fs.readFileSync(path.join(VEC, item.file)));
  const img = { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  const expected = fs.readFileSync(path.join(VEC, item.expectedFile), "utf8");
  const key = `v${item.version}/${item.level}`;
  const g = (groups[key] ||= { n: 0, det: 0, cfg: Object.fromEntries(CONFIGS.map(([n]) => [n, 0])) });
  g.n++;
  if (detected(img, true)) g.det++;
  for (const [name, opts] of CONFIGS) {
    let ok = false;
    try { const r = decode(img, opts); ok = !!(r && r.text === expected); } catch {}
    if (ok) g.cfg[name]++;
  }
}

const order = { mild: 0, moderate: 1, strong: 2 };
const keys = Object.keys(groups).sort((a, b) => {
  const [va, la] = a.split("/"), [vb, lb] = b.split("/");
  return (+va.slice(1)) - (+vb.slice(1)) || order[la] - order[lb];
});

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("group", 16), pad("det", 7), CONFIGS.map(([n]) => pad(n, 10)).join(""));
const tot = { n: 0, det: 0, cfg: Object.fromEntries(CONFIGS.map(([n]) => [n, 0])) };
for (const key of keys) {
  const g = groups[key];
  tot.n += g.n; tot.det += g.det;
  for (const [n] of CONFIGS) tot.cfg[n] += g.cfg[n];
  console.log(pad(key, 16), pad(`${g.det}/${g.n}`, 7),
    CONFIGS.map(([n]) => pad(`${g.cfg[n]}/${g.n}`, 10)).join(""));
}
console.log(pad("TOTAL", 16), pad(`${tot.det}/${tot.n}`, 7),
  CONFIGS.map(([n]) => pad(`${tot.cfg[n]}/${tot.n}`, 10)).join(""));
