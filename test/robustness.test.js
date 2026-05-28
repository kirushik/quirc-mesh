// Fail-closed + robustness guards (AC-4): garbage/noisy/cluttered input must never
// crash and never return a confidently-wrong payload. Also guards the regression
// where noise spawned bogus out-of-range grids that crashed/froze the decoder.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { decode } from "../src/index.js";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

function noiseImage(w, h, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = (rnd() * 256) | 0;
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("random noise decodes to nothing (no false positive, no throw)", () => {
  for (const seed of [1, 2, 3]) {
    let r;
    assert.doesNotThrow(() => { r = decode(noiseImage(640, 480, seed), { mesh: true, adaptive: true }); });
    assert.equal(r, null, `noise seed ${seed} must not decode`);
  }
});

test("blank image decodes to nothing", () => {
  const data = new Uint8ClampedArray(320 * 240 * 4).fill(255);
  for (let i = 0; i < 320 * 240; i++) data[i * 4 + 3] = 255;
  assert.equal(decode({ data, width: 320, height: 240 }, { mesh: true, adaptive: true }), null);
});

// Cluttered close-up: a scaled v40 plus dark "hand" blobs + sensor noise — the
// conditions that previously spawned bogus v49..v153 grids and crashed/froze.
// Must complete quickly, never throw, and either read v40 exactly or read nothing.
test("cluttered v40 frame: no crash, no wrong read, bounded time", () => {
  const png = PNG.sync.read(fs.readFileSync("test-vectors/images/qr_worst_2of3_fullkey_ECL.png"));
  const sw = png.width, sh = png.height;
  const src = new Float32Array(sw * sh);
  for (let i = 0, p = 0; i < sw * sh; i++, p += 4) src[i] = png.data[p];

  const W = 1280, H = 720, out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) out[i * 4 + 3] = 255;
  const scale = 700 / sh, cx = W / 2, cy = H / 2;
  let s = 7; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
    const sx = (ox - cx) / scale + sw / 2, sy = (oy - cy) / scale + sh / 2;
    let v = 235;
    if (sx >= 0 && sy >= 0 && sx < sw - 1 && sy < sh - 1) {
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      v = src[y0 * sw + x0] * (1 - fx) * (1 - fy) + src[y0 * sw + x0 + 1] * fx * (1 - fy) +
          src[(y0 + 1) * sw + x0] * (1 - fx) * fy + src[(y0 + 1) * sw + x0 + 1] * fx * fy;
    }
    if (ox < W * 0.16 || ox > W * 0.84) v = Math.min(v, 60 + rnd() * 30);
    v += (rnd() * 2 - 1) * 12;
    const idx = (oy * W + ox) * 4, c = Math.max(0, Math.min(255, v)) | 0;
    out[idx] = c; out[idx + 1] = c; out[idx + 2] = c;
  }
  const img = { data: out, width: W, height: H };

  const t0 = performance.now();
  let r;
  assert.doesNotThrow(() => { r = decode(img, { mesh: true, adaptive: true }); });
  const ms = performance.now() - t0;

  const expected = fs.readFileSync("test-vectors/expected/qr_worst_2of3_fullkey_ECL.txt", "utf8");
  if (r) assert.equal(r.text, expected, "if it decodes, it must be the correct v40 payload (never wrong)");
  assert.ok(ms < 1500, `decode should be bounded (was ${ms.toFixed(0)}ms) — guards the freeze regression`);
});
