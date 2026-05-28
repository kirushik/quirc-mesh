// Clean-image validation harness.
//
// Loads test-vectors/manifest.json, decodes each PNG with the quirc-mesh decoder
// (src/index.js -> export `decode(imageData) => { text, ... }`), and diffs the
// result against test-vectors/expected/<name>.txt (byte-for-byte).
//
// Until src/index.js exists it reports every vector as FAIL (the target to make
// green). Run: `node harness/run.mjs`
//
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const VEC = path.join(ROOT, "test-vectors");

// pngjs from local node_modules (after `npm install`).
const req = createRequire(path.join(ROOT, "x.js"));
let PNG;
try { ({ PNG } = await import(pathToFileURL(req.resolve("pngjs")))); }
catch { console.error("Missing dep: run `npm install` (pngjs)."); process.exit(2); }

// The decoder under test (does not exist yet — Milestone 1).
let decode = null;
try { ({ decode } = await import(pathToFileURL(path.join(ROOT, "src/index.js")))); }
catch { console.error("No decoder yet (src/index.js). Reporting all FAIL.\n"); }

const manifest = JSON.parse(fs.readFileSync(path.join(VEC, "manifest.json"), "utf8"));
let pass = 0, fail = 0;
const rows = [];

for (const v of manifest.vectors) {
  const png = PNG.sync.read(fs.readFileSync(path.join(VEC, v.file)));
  const img = { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  const expected = fs.readFileSync(path.join(VEC, v.expectedFile), "utf8");

  let got = null, err = null, ms = 0;
  if (decode) {
    const t0 = performance.now();
    try { const r = decode(img); got = (r && r.text) || null; }
    catch (e) { err = e.message || String(e); }
    ms = performance.now() - t0;
  }
  const ok = got === expected;
  ok ? pass++ : fail++;
  rows.push({ name: path.basename(v.file), v: v.version, ec: v.ecLevel, ok, ms: ms.toFixed(0), err });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("vector", 36), pad("ver", 4), pad("ec", 3), pad("ms", 6), "result");
for (const r of rows) {
  console.log(pad(r.name, 36), pad("v" + r.v, 4), pad(r.ec, 3), pad(r.ms, 6),
    r.ok ? "PASS" : "FAIL" + (r.err ? " (" + r.err + ")" : ""));
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
