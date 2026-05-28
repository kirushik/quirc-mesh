// Reproduce the near-full-frame camera hang headlessly: render the v40 vector
// almost filling a 1080p frame (large modules, slight tilt + radial + noise), run
// the camera path, and time each phase to attribute the cost.
//
//   node harness/repro-fullframe.mjs [spanFrac] [tilt]

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
const { toGray, binarizeAdaptive } = await import(pathToFileURL(path.join(ROOT, "src/binarize.js")));
const { detect } = await import(pathToFileURL(path.join(ROOT, "src/finder.js")));

const SPAN_FRAC = parseFloat(process.argv[2] || "0.95");
const TILT = parseFloat(process.argv[3] || "0.04");
const W = 1920, H = 1080;

const png = PNG.sync.read(fs.readFileSync(path.join(VEC, "images/qr_worst_2of3_fullkey_ECL.png")));
const sw = png.width, sh = png.height;
const src = new Float32Array(sw * sh);
for (let i = 0, p = 0; i < sw * sh; i++, p += 4) src[i] = png.data[p];

function solveH(srcPts, dstPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = srcPts[i], { x: X, y: Y } = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    const d = A[col][col];
    for (let j = col; j < 8; j++) A[col][j] /= d; b[col] /= d;
    for (let r = 0; r < 8; r++) { if (r === col) continue; const f = A[r][col]; if (!f) continue;
      for (let j = col; j < 8; j++) A[r][j] -= f * A[col][j]; b[r] -= f * b[col]; }
  }
  return b;
}
const ah = (h, x, y) => { const d = h[6] * x + h[7] * y + 1; return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d }; };

let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const span = H * SPAN_FRAC, off = (W - span) / 2, offY = (H - span) / 2;
const j = () => (rnd() * 2 - 1) * TILT * H;
const dst = [
  { x: off + j(), y: offY + j() }, { x: off + span + j(), y: offY + j() },
  { x: off + span + j(), y: offY + span + j() }, { x: off + j(), y: offY + span + j() },
];
const srcRect = [{ x: 0, y: 0 }, { x: sw, y: 0 }, { x: sw, y: sh }, { x: 0, y: sh }];
const Hm = solveH(dst, srcRect);
const cx = W / 2, cy = H / 2, R2 = ((W / 2) ** 2 + (H / 2) ** 2);
const k1 = 0.06;
const data = new Uint8ClampedArray(W * H * 4);
for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
  const dx = ox - cx, dy = oy - cy, r2 = (dx * dx + dy * dy) / R2;
  const f = 1 + k1 * r2;
  const sp = ah(Hm, cx + dx * f, cy + dy * f);
  let v = 235;
  if (sp.x >= 0 && sp.y >= 0 && sp.x < sw - 1 && sp.y < sh - 1) {
    const x0 = Math.floor(sp.x), y0 = Math.floor(sp.y), fx = sp.x - x0, fy = sp.y - y0;
    v = src[y0 * sw + x0] * (1 - fx) * (1 - fy) + src[y0 * sw + x0 + 1] * fx * (1 - fy) +
        src[(y0 + 1) * sw + x0] * (1 - fx) * fy + src[(y0 + 1) * sw + x0 + 1] * fx * fy;
  }
  v += (rnd() * 2 - 1) * 8;
  const idx = (oy * W + ox) * 4, c = Math.max(0, Math.min(255, v)) | 0;
  data[idx] = c; data[idx + 1] = c; data[idx + 2] = c; data[idx + 3] = 255;
}
const img = { data, width: W, height: H };
console.log(`frame ${W}x${H}, spanFrac=${SPAN_FRAC}, tilt=${TILT}, ~${(span / 177).toFixed(1)} px/module`);

const t = (label, fn) => { const t0 = performance.now(); const r = fn(); const ms = performance.now() - t0; console.log(`  ${label.padEnd(16)} ${ms.toFixed(0)} ms`); return r; };

const gray = t("toGray", () => toGray(img));
const pixels = t("binarizeAdaptive", () => binarizeAdaptive(gray, W, H));
const q = { w: W, h: H, pixels: pixels.slice(), regions: [null, null], capstones: [], grids: [], _diag: {} };
t("detect", () => detect(q));
console.log(`  -> capstones=${q.capstones.length}  grids=${q.grids.length}`);
const d = q._diag;
console.log(`  grouping: both=${d.grouping_both || 0} nopair=${d.grouping_nopair || 0}  square_pass=${d.square_pass || 0} square_fail=${d.square_fail || 0}  rejV=${d.reject_version || 0} rejI=${d.reject_no_inter || 0} recorded_v=[${d.recorded_version || ""}]`);
if (d.pair_uv) for (const p of d.pair_uv) {
  const hR = p.uu / (p.vv || 1e-9), vR = p.vv / (p.uu || 1e-9);
  console.log(`    ${p.i}->${p.j}: uu=${p.uu.toFixed(1)} vv=${p.vv.toFixed(1)} h=${hR.toFixed(2)} v=${vR.toFixed(2)} [${hR < 0.4 ? "H" : vR < 0.4 ? "V" : "-"}]`);
}
if (d.squareness) console.log(`  squareness vals: ${d.squareness.map((x) => x.toFixed(2)).join(", ")} (pass if < 0.5)`);

const r = t("decode (total)", () => decode(img, { adaptive: true }));
console.log(`  -> ${r ? "DECODED v" + r.version : "null"}`);
