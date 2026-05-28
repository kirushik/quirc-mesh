// Synthetic camera-like distortion generator.
//
// Produces degraded versions of the clean corpus PNGs to validate the mesh
// sampler WITHOUT a physical camera. This file deliberately shares NO code with
// src/ — it is an independent oracle for the failure mode, so a passing mesh is a
// real result and not a tautology.
//
// The DISTINGUISHING distortion is non-projective: a single homography models any
// flat perspective view exactly, so pure perspective would not break the
// single-homography baseline. We therefore apply RADIAL LENS DISTORTION (and a
// mild perspective tilt for realism) — radial warp is exactly what an
// alignment-pattern mesh corrects and a global homography cannot. Blur, sensor
// noise and a lighting gradient add realism.
//
//   node harness/gen-distorted.mjs
// -> writes test-vectors/distorted/*.png + index.json (both gitignored).

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

// --- seedable RNG (mulberry32) ---
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- independent grayscale load (do NOT import src/binarize) ---
function loadGray(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: w, height: h, data } = png;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { g, w, h };
}

// Solve a projective transform mapping the 4 src points to the 4 dst points.
// Returns [h0..h7] with x' = (h0 x+h1 y+h2)/(h6 x+h7 y+1), similarly y'.
function solveHomography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  // Gaussian elimination with partial pivoting (8x8).
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const d = A[col][col];
    for (let j = col; j < 8; j++) A[col][j] /= d;
    b[col] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let j = col; j < 8; j++) A[r][j] -= f * A[col][j];
      b[r] -= f * b[col];
    }
  }
  return b;
}

function applyH(h, x, y) {
  const den = h[6] * x + h[7] * y + 1;
  return { x: (h[0] * x + h[1] * y + h[2]) / den, y: (h[3] * x + h[4] * y + h[5]) / den };
}

// Separable Gaussian blur in place-ish (returns new buffer).
function blur(buf, w, h, sigma) {
  if (sigma <= 0) return buf;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + radius] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) { let xx = x + i; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1; acc += buf[y * w + xx] * k[i + radius]; }
    tmp[y * w + x] = acc;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) { let yy = y + i; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1; acc += tmp[yy * w + x] * k[i + radius]; }
    out[y * w + x] = acc;
  }
  return out;
}

// Distortion presets. k1/k2: radial coefficients; tilt: max perspective corner
// jitter (fraction of canvas); blur sigma (px); noise sigma (0-255); light: min
// multiplicative brightness at the dark corner of the gradient.
const LEVELS = {
  mild:     { k1: 0.04, k2: 0.00, tilt: 0.04, sigma: 0.7, noise: 4, light: 0.85 },
  moderate: { k1: 0.10, k2: 0.01, tilt: 0.08, sigma: 1.0, noise: 7, light: 0.72 },
  strong:   { k1: 0.16, k2: 0.025, tilt: 0.12, sigma: 1.3, noise: 9, light: 0.60 },
};

const VECTORS = [
  "qr_ladder_v12", "qr_ladder_v25", "qr_ladder_v34",
  "qr_mid_3of5_fullkey_ECM", "qr_worst_2of3_fullkey_ECL",
];
const SEEDS = [1, 2, 3];
const CANVAS = 1200;            // output is CANVAS x CANVAS grayscale
const SPAN = 1040;              // the QR (with its quiet zone) spans ~this many px

function generate(srcFile, level, seed) {
  const { g: src, w: sw, h: sh } = loadGray(srcFile);
  const rnd = rng(seed * 1009 + Object.keys(LEVELS).indexOf(level) * 7 + 13);
  const p = LEVELS[level];

  // Ideal-space quad where the QR lands (centered SPAN box, corners jittered).
  const off = (CANVAS - SPAN) / 2;
  const j = () => (rnd() * 2 - 1) * p.tilt * CANVAS;
  const dstQuad = [
    { x: off + j(), y: off + j() },
    { x: off + SPAN + j(), y: off + j() },
    { x: off + SPAN + j(), y: off + SPAN + j() },
    { x: off + j(), y: off + SPAN + j() },
  ];
  // Homography mapping ideal-space (the QR quad) -> source image rectangle.
  const srcRect = [{ x: 0, y: 0 }, { x: sw, y: 0 }, { x: sw, y: sh }, { x: 0, y: sh }];
  const H = solveHomography(dstQuad, srcRect);

  // Radial distortion about a slightly off-center point.
  const cx = CANVAS / 2 + (rnd() * 2 - 1) * 0.05 * CANVAS;
  const cy = CANVAS / 2 + (rnd() * 2 - 1) * 0.05 * CANVAS;
  const R2 = (CANVAS / 2) ** 2 * 2;

  const out = new Float32Array(CANVAS * CANVAS);
  const bg = 235;
  for (let oy = 0; oy < CANVAS; oy++) {
    for (let ox = 0; ox < CANVAS; ox++) {
      const dx = ox - cx, dy = oy - cy;
      const r2 = (dx * dx + dy * dy) / R2;
      const f = 1 + p.k1 * r2 + p.k2 * r2 * r2;     // sensor -> ideal (radial)
      const ix = cx + dx * f, iy = cy + dy * f;
      const s = applyH(H, ix, iy);                   // ideal -> source
      out[oy * CANVAS + ox] = sampleBilinear(src, sw, sh, s.x, s.y, bg);
    }
  }

  let buf = blur(out, CANVAS, CANVAS, p.sigma);

  // Lighting gradient (random direction) + mild vignette, then noise.
  const ang = rnd() * Math.PI * 2, gx = Math.cos(ang), gy = Math.sin(ang);
  for (let oy = 0; oy < CANVAS; oy++) {
    for (let ox = 0; ox < CANVAS; ox++) {
      const t = ((ox / CANVAS - 0.5) * gx + (oy / CANVAS - 0.5) * gy) + 0.5; // 0..1
      const light = p.light + (1 - p.light) * t;
      let v = buf[oy * CANVAS + ox] * light;
      v += (rnd() * 2 - 1) * p.noise;
      buf[oy * CANVAS + ox] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return buf;
}

function sampleBilinear(src, w, h, x, y, bg) {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return bg;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const a = src[y0 * w + x0], b = src[y0 * w + x0 + 1];
  const c = src[(y0 + 1) * w + x0], d = src[(y0 + 1) * w + x0 + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

function writeGrayPng(buf, file) {
  const png = new PNG({ width: CANVAS, height: CANVAS });
  for (let i = 0; i < CANVAS * CANVAS; i++) {
    const v = buf[i] | 0;
    png.data[i * 4] = v; png.data[i * 4 + 1] = v; png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

fs.mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(VEC, "manifest.json"), "utf8"));
const byName = Object.fromEntries(manifest.vectors.map(v => [path.basename(v.file, ".png"), v]));

const index = [];
let count = 0;
for (const name of VECTORS) {
  const v = byName[name];
  const srcFile = path.join(VEC, v.file);
  for (const level of Object.keys(LEVELS)) {
    for (const seed of SEEDS) {
      const buf = generate(srcFile, level, seed);
      const outName = `${name}__${level}__s${seed}.png`;
      writeGrayPng(buf, path.join(OUT, outName));
      index.push({ file: `distorted/${outName}`, source: name, level, seed,
        version: v.version, ecLevel: v.ecLevel, expectedFile: v.expectedFile });
      count++;
    }
  }
  console.log(`generated ${name} (v${v.version})`);
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`\nWrote ${count} distorted vectors -> ${path.relative(ROOT, OUT)}/`);
