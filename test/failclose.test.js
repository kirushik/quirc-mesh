// Fail-closed guarantee (AC-4), bounded for the regular suite: corrupted / noisy
// / cropped input must yield null or the correct payload — NEVER a wrong one.
// The thorough sweep lives in harness/fuzz.mjs (npm run fuzz).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { decode } from "../src/index.js";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

function rng(seed) {
  let a = seed >>> 0;
  return () => (a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
function loadRGBA(name) {
  const png = PNG.sync.read(fs.readFileSync(`test-vectors/images/${name}.png`));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}
function corrupt(img, frac, rnd) {
  const out = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  for (let i = 0; i < img.width * img.height; i++) {
    if (rnd() < frac) { const v = (rnd() * 256) | 0; out.data[i * 4] = v; out.data[i * 4 + 1] = v; out.data[i * 4 + 2] = v; }
  }
  return out;
}

// Assert null-or-correct (never wrong) and that decode never throws.
function assertFailClosed(img, expected, tag) {
  let r;
  assert.doesNotThrow(() => { r = decode(img, { mesh: true, adaptive: true }); }, `${tag} threw`);
  if (r) assert.equal(r.text, expected, `${tag}: returned a WRONG payload (fail-closed violated)`);
}

test("pixel-corruption sweep is fail-closed (null or correct, never wrong)", () => {
  for (const name of ["qr_ladder_v25", "qr_worst_2of3_fullkey_ECL"]) {
    const img = loadRGBA(name);
    const expected = fs.readFileSync(`test-vectors/expected/${name}.txt`, "utf8");
    for (const frac of [0.05, 0.15, 0.3, 0.5]) {
      for (let t = 0; t < 6; t++) {
        assertFailClosed(corrupt(img, frac, rng(t * 131 + frac * 1000)), expected, `${name} @${frac}`);
      }
    }
  }
});

test("pure noise never decodes to a payload", () => {
  for (let t = 0; t < 12; t++) {
    const w = 600, h = 480, rnd = rng(t * 977);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = (rnd() * 256) | 0; data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
    let r;
    assert.doesNotThrow(() => { r = decode({ data, width: w, height: h }, { mesh: true, adaptive: true }); });
    assert.equal(r, null, `noise ${t} produced a false-positive decode`);
  }
});
