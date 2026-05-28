// Core-IP regression: under non-projective (radial lens) distortion, the mesh
// sampler decodes high-version codes that the single global homography cannot.
// Deterministic warp (no randomness) so the assertions are stable.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { decode } from "../src/index.js";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const CAN = 1200, SPAN = 1040;

// Pure radial (barrel/pincushion) warp — the distortion a single homography
// cannot model. No perspective/blur/noise, to isolate the sampling effect.
function radialWarp(name, k1) {
  const png = PNG.sync.read(fs.readFileSync(`test-vectors/images/${name}.png`));
  const sw = png.width, sh = png.height;
  const src = new Float32Array(sw * sh);
  for (let i = 0, p = 0; i < sw * sh; i++, p += 4)
    src[i] = 0.299 * png.data[p] + 0.587 * png.data[p + 1] + 0.114 * png.data[p + 2];

  const out = new Uint8ClampedArray(CAN * CAN * 4);
  const off = (CAN - SPAN) / 2, cx = CAN / 2, cy = CAN / 2, R2 = (CAN / 2) ** 2 * 2, bg = 235;
  for (let oy = 0; oy < CAN; oy++) {
    for (let ox = 0; ox < CAN; ox++) {
      const dx = ox - cx, dy = oy - cy, r2 = (dx * dx + dy * dy) / R2, f = 1 + k1 * r2;
      const ix = cx + dx * f, iy = cy + dy * f;
      const u = (ix - off) / SPAN, v = (iy - off) / SPAN;
      const sx = u * sw, sy = v * sh;
      let val = bg;
      if (sx >= 0 && sy >= 0 && sx < sw - 1 && sy < sh - 1) {
        const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        val = src[y0 * sw + x0] * (1 - fx) * (1 - fy) + src[y0 * sw + x0 + 1] * fx * (1 - fy) +
              src[(y0 + 1) * sw + x0] * (1 - fx) * fy + src[(y0 + 1) * sw + x0 + 1] * fx * fy;
      }
      const idx = (oy * CAN + ox) * 4, c = val | 0;
      out[idx] = c; out[idx + 1] = c; out[idx + 2] = c; out[idx + 3] = 255;
    }
  }
  return { data: out, width: CAN, height: CAN };
}

function expected(name) {
  return fs.readFileSync(`test-vectors/expected/${name}.txt`, "utf8");
}

// Cases verified to detect correctly at this distortion; the point is mesh vs single.
const MESH_WINS = [
  ["qr_ladder_v25", 0.025],
  ["qr_ladder_v34", 0.025],
  ["qr_worst_2of3_fullkey_ECL", 0.025], // v40 — the AC-2 acid-test code
];

for (const [name, k1] of MESH_WINS) {
  test(`mesh beats single under radial k1=${k1}: ${name}`, () => {
    const img = radialWarp(name, k1);
    const exp = expected(name);
    const single = decode(img, { mesh: false });
    const mesh = decode(img, { mesh: true });
    assert.ok(!single || single.text !== exp, `single homography should FAIL on ${name}`);
    assert.ok(mesh && mesh.text === exp, `mesh should DECODE ${name}`);
  });
}

test("mesh does not regress an easy low-version code under the same warp", () => {
  const img = radialWarp("qr_ladder_v17", 0.025);
  const exp = expected("qr_ladder_v17");
  const mesh = decode(img, { mesh: true });
  assert.ok(mesh && mesh.text === exp, "v17 should still decode with mesh");
});
