// Benchmark — quirc-mesh (pure JS) vs zxing-cpp (WASM) on identical inputs.
// Decides the PRD's JS-vs-WASM question (docs/BENCHMARK_PLAN.md): pure-JS ships if
// the worst case (v40) is well under ~1 s/frame with comparable success.
//
//   node harness/bench.mjs [iterations]   # default 40
//
// Measures per-frame decode latency over the clean corpus (the v40 PNG is 1480^2
// ~= a 1080p frame, so it tracks the camera worst case). Reports median + p90.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VEC = path.join(ROOT, "test-vectors");

const req = createRequire(path.join(ROOT, "x.js"));
const { PNG } = await import(pathToFileURL(req.resolve("pngjs")));
const { decode } = await import(pathToFileURL(path.join(ROOT, "src/index.js")));
const { setZXingModuleOverrides, readBarcodesFromImageData } =
  await import(pathToFileURL(req.resolve("zxing-wasm/reader")));

const WASM = path.join(ROOT, "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
setZXingModuleOverrides({ wasmBinary: fs.readFileSync(WASM) });
globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };

const N = Number(process.argv[2]) || 40;
const WARMUP = 5;
const ZOPTS = { formats: ["QRCode"], tryHarder: true };

const manifest = JSON.parse(fs.readFileSync(path.join(VEC, "manifest.json"), "utf8"));

function stats(times) {
  const s = times.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p90: q(0.9), min: s[0] };
}

function loadImage(file) {
  const png = PNG.sync.read(fs.readFileSync(path.join(VEC, file)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

async function benchZxing(img) {
  for (let i = 0; i < WARMUP; i++) await readBarcodesFromImageData(img, ZOPTS);
  const t = [];
  let ok = false;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const r = await readBarcodesFromImageData(img, ZOPTS);
    t.push(performance.now() - t0);
    ok = !!(r[0] && r[0].text);
  }
  return { ...stats(t), ok };
}

function benchJs(img) {
  for (let i = 0; i < WARMUP; i++) decode(img);
  const t = [];
  let ok = false;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const r = decode(img);
    t.push(performance.now() - t0);
    ok = !!(r && r.text);
  }
  return { ...stats(t), ok };
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`Per-frame decode latency, ${N} iters (median / p90 ms). Node ${process.version}\n`);
console.log(pad("vector", 22), pad("ver", 5), pad("quirc-mesh JS", 22), pad("zxing-cpp WASM", 22));

let worst = null;
for (const v of manifest.vectors) {
  const img = loadImage(v.file);
  const js = benchJs(img);
  const zx = await benchZxing(img);
  const fmt = (r) => `${r.median.toFixed(1)}/${r.p90.toFixed(1)}${r.ok ? "" : " (FAIL)"}`;
  console.log(pad(path.basename(v.file, ".png"), 22), pad("v" + v.version, 5), pad(fmt(js), 22), pad(fmt(zx), 22));
  if (v.version === 40) worst = { js, zx };
}

if (worst) {
  console.log(`\n--- decision (v40 worst case) ---`);
  console.log(`quirc-mesh JS: median ${worst.js.median.toFixed(1)} ms, p90 ${worst.js.p90.toFixed(1)} ms`);
  console.log(`zxing-cpp WASM: median ${worst.zx.median.toFixed(1)} ms, p90 ${worst.zx.p90.toFixed(1)} ms`);
  const verdict = worst.js.p90 < 1000
    ? `SHIP PURE-JS: v40 p90 ${worst.js.p90.toFixed(0)} ms is well under the ~1 s/frame bar — no WASM blob needed.`
    : `Consider WASM: v40 p90 ${worst.js.p90.toFixed(0)} ms exceeds the responsiveness bar.`;
  console.log(verdict);
}
