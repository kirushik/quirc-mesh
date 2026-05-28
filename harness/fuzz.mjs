// Fail-closed fuzz harness (AC-4). The one property that matters for a backup
// tool: the decoder must return null OR the exact correct payload — NEVER a
// confidently-wrong one. This throws corrupted / noisy / cropped / non-QR images
// at the decoder in bulk and counts: correct, no-decode, and WRONG (false reads).
// WRONG must be 0. Exits non-zero otherwise.
//
//   node harness/fuzz.mjs [trialsPerLevel]   # default 30

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

const T = Number(process.argv[2]) || 30;
const manifest = JSON.parse(fs.readFileSync(path.join(VEC, "manifest.json"), "utf8"));

function rng(seed) {
  let a = seed >>> 0;
  return () => (a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
function loadRGBA(file) {
  const png = PNG.sync.read(fs.readFileSync(path.join(VEC, file)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}
function clone(img) {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

// Salt-and-pepper: flip a fraction of pixels to random gray.
function corrupt(img, frac, rnd) {
  const out = clone(img);
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    if (rnd() < frac) {
      const v = (rnd() * 256) | 0;
      out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v;
    }
  }
  return out;
}
function noise(w, h, rnd) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = (rnd() * 256) | 0;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}
// Crop: keep a sub-rectangle of the code (the rest becomes white) — partial codes
// must fail closed, not invent a payload.
function crop(img, keepFrac, rnd) {
  const out = clone(img);
  const { width: w, height: h } = img;
  const cw = (w * keepFrac) | 0, ch = (h * keepFrac) | 0;
  const ox = (rnd() * (w - cw)) | 0, oy = (rnd() * (h - ch)) | 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= ox && x < ox + cw && y >= oy && y < oy + ch) continue;
    const i = (y * w + x) * 4;
    out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255;
  }
  return out;
}

let totalCorrect = 0, totalNull = 0, totalWrong = 0;
const wrongSamples = [];

function classify(img, expected, tag) {
  let r = null;
  try { r = decode(img, { mesh: true, adaptive: true }); } catch (e) { wrongSamples.push(`${tag}: THREW ${e.message}`); }
  if (!r) { totalNull++; return; }
  if (expected != null && r.text === expected) { totalCorrect++; return; }
  totalWrong++;
  if (wrongSamples.length < 10) wrongSamples.push(`${tag}: WRONG v${r.version} ${r.ecLevel} "${r.text.slice(0, 24)}…"`);
}

const subset = manifest.vectors.filter((v) => [10, 25, 40].includes(v.version));

console.log(`Fuzzing ${T} trials/level. Property: result is null or correct, never wrong.\n`);

// 1) Pixel corruption sweep on real codes.
for (const v of subset) {
  const img = loadRGBA(v.file);
  const expected = fs.readFileSync(path.join(VEC, v.expectedFile), "utf8");
  for (const frac of [0.02, 0.05, 0.1, 0.2, 0.35, 0.5]) {
    let c = 0, z = 0, w = 0;
    for (let t = 0; t < T; t++) {
      const before = [totalCorrect, totalNull, totalWrong];
      classify(corrupt(img, frac, rng(t * 131 + frac * 1000)), expected, `v${v.version} corrupt ${frac}`);
      c += totalCorrect - before[0]; z += totalNull - before[1]; w += totalWrong - before[2];
    }
    console.log(`v${v.version} corrupt ${String(frac).padEnd(5)}  correct=${c} null=${z} WRONG=${w}`);
  }
}

// 2) Pure noise — any decode is a false positive.
{
  let w = 0;
  for (let t = 0; t < T * 3; t++) {
    const before = totalWrong + totalCorrect;
    classify(noise(600 + (t % 5) * 120, 480, rng(t * 977)), null, `noise ${t}`);
    w += (totalWrong + totalCorrect) - before;
  }
  console.log(`pure noise          decoded-anything=${w}  (must be 0)`);
}

// 3) Crops of real codes.
for (const v of subset) {
  const img = loadRGBA(v.file);
  const expected = fs.readFileSync(path.join(VEC, v.expectedFile), "utf8");
  let w = 0;
  for (const keep of [0.4, 0.6, 0.8]) {
    for (let t = 0; t < T; t++) {
      const before = totalWrong;
      classify(crop(img, keep, rng(t * 17 + keep * 100)), expected, `v${v.version} crop ${keep}`);
      w += totalWrong - before;
    }
  }
  console.log(`v${v.version} crops          WRONG=${w}`);
}

console.log(`\nTOTAL  correct=${totalCorrect}  null=${totalNull}  WRONG=${totalWrong}`);
if (wrongSamples.length) { console.log("\nfalse reads:"); for (const s of wrongSamples) console.log("  " + s); }
console.log(totalWrong === 0 ? "\n✓ FAIL-CLOSED HOLDS: zero wrong reads." : "\n✗ FALSE POSITIVE(S) DETECTED.");
process.exit(totalWrong === 0 ? 0 : 1);
