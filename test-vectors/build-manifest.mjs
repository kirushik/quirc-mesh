// Build a ground-truth manifest for the QR test corpus.
//
// Decodes every PNG in ./images with zxing-cpp (WASM) — the ONE engine known to
// read these dense codes correctly — and writes:
//   - ./expected/<name>.txt   : the exact decoded payload (the bytes a correct
//                               decoder MUST reproduce)
//   - ./manifest.json         : index {file, sha256, version, modules, ecLevel,
//                               charCount, expectedFile}
//
// These payloads are random data (see gen-sample-qr.js, crypto.randomBytes) wrapped
// in a placeholder "BS2 ..." header — NOT real key material. Safe to publish.
//
// Run from a dir that has zxing-wasm + pngjs installed (the banana_split _scratch
// toolchain), e.g.:
//   cd ../../_scratch && node ../quirc-mesh/test-vectors/build-manifest.mjs
//
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

// Resolve the decoder deps from the CURRENT WORKING DIR's node_modules (so this
// can run against the banana_split _scratch toolchain while living in the bundle).
const cwdRequire = createRequire(path.join(process.cwd(), "x.js"));
const { setZXingModuleOverrides, readBarcodes } =
  await import(pathToFileURL(cwdRequire.resolve("zxing-wasm/reader")));
const { PNG } = await import(pathToFileURL(cwdRequire.resolve("pngjs")));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.join(HERE, "images");
const EXPECTED = path.join(HERE, "expected");
fs.mkdirSync(EXPECTED, { recursive: true });

// zxing reader wasm from the local install (resolve from CWD's node_modules).
const wasmPath = path.resolve("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
setZXingModuleOverrides({ wasmBinary: fs.readFileSync(wasmPath) });
globalThis.ImageData = class ImageData { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };

// Known metadata (version, EC) for vectors whose generation params we recorded.
const KNOWN = {
  "qr_worst_2of3_fullkey_ECL.png": { version: 40, ecLevel: "L", note: "2-of-3 stress case; full 4096 keypair fragment; PRINTED & camera-tested (zxing-cpp WASM: OK at 5.6 px/module)" },
  "qr_mid_3of5_fullkey_ECM.png":   { version: 37, ecLevel: "M", note: "3-of-5 full 4096 keypair fragment; PRINTED & camera-tested" },
  "qr_easy_3of5_seedphrase_ECH.png": { version: 10, ecLevel: "H", note: "seed-phrase sized; scans on everything (control)" },
};

const OPTS = { formats: ["QRCode"], tryHarder: true, tryDownscale: false };
const files = fs.readdirSync(IMAGES).filter(f => f.endsWith(".png")).sort();
const manifest = [];

for (const f of files) {
  const buf = fs.readFileSync(path.join(IMAGES, f));
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const png = PNG.sync.read(buf);
  const img = new ImageData(new Uint8ClampedArray(png.data), png.width, png.height);
  const res = await readBarcodes(img, OPTS);
  const r = res[0];
  if (!r || !r.text) { console.error(`!! ${f}: NO DECODE`); continue; }

  const ladder = /qr_ladder_v(\d+)\.png/.exec(f);
  const version = KNOWN[f]?.version ?? (ladder ? +ladder[1] : null);
  const ecLevel = KNOWN[f]?.ecLevel ?? (r.ecLevel || null);
  const modules = version ? version * 4 + 17 : null;

  const expectedFile = f.replace(/\.png$/, ".txt");
  fs.writeFileSync(path.join(EXPECTED, expectedFile), r.text);

  manifest.push({
    file: `images/${f}`,
    sha256,
    pngPx: `${png.width}x${png.height}`,
    version,
    modules,
    ecLevel,
    charCount: r.text.length,
    prefix: r.text.slice(0, 12),
    expectedFile: `expected/${expectedFile}`,
    note: KNOWN[f]?.note ?? "clean-image regression rung",
  });
  console.log(`${f} -> v${version ?? "?"} EC-${ecLevel ?? "?"} ${modules ?? "?"}mod ${r.text.length}chars sha256=${sha256.slice(0, 12)}…`);
}

fs.writeFileSync(path.join(HERE, "manifest.json"), JSON.stringify({
  generatedBy: "zxing-cpp (WASM) via zxing-wasm — ground truth",
  generatedAt: new Date().toISOString().slice(0, 10),
  warning: "Payloads are random data, not real secrets. A correct decoder must reproduce expectedFile byte-for-byte.",
  vectors: manifest,
}, null, 2) + "\n");
console.log(`\nWrote manifest.json (${manifest.length} vectors) + expected/*.txt`);
