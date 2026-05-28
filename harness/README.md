# Harness

Two harnesses: clean-image (Node) and camera (browser).

## Clean-image — `run.mjs` (Milestones 1–2)

```
npm install         # pngjs (+ zxing-wasm for the oracle)
node harness/run.mjs
```

Loads `test-vectors/manifest.json`, decodes each PNG with `src/index.js`'s
`decode(imageData)`, diffs against `expected/<name>.txt`, prints a pass/fail table
with per-vector decode time. Exits non-zero if any fail.

Until `src/index.js` exists it prints all FAIL — that's the red test to make green.
`decode` must accept `{ data: Uint8ClampedArray (RGBA), width, height }` (an
`ImageData`-shaped object) and return `{ text: string, ... }` or throw / return
falsy on failure.

Target progression:
- M1: low/mid rungs pass (single-homography baseline).
- M2: **all 10 pass**, including v37/v40 (mesh sampling), on clean images.

## Synthetic distortion — `gen-distorted.mjs` + `run-synth.mjs` (no camera needed)

```
npm run synth:gen     # writes test-vectors/distorted/*.png (gitignored)
npm run synth         # decodes them: single vs mesh vs mesh+adaptive, + detection rate
```

`gen-distorted.mjs` synthesizes camera-like degraded vectors (perspective + **radial
lens distortion** + blur + noise + lighting gradient) from the clean PNGs. Radial
distortion is the key: a single homography models any flat perspective exactly, so
only a *non-projective* warp (lens/curl) exercises the mesh. It shares no code with
`src/` so a passing mesh is a real result. `run-synth.mjs` reports, per
version/level, the detection rate (`det`) and decode success for each sampler.

`test/mesh.test.js` is the locked-in proof: under radial distortion the mesh
decodes v25/v34/v40 byte-exact where the single homography fails.

## Camera — `camera.html` + `serve.mjs` (the physical acid test)

```
npm run serve         # http://localhost:8000  (localhost = secure context for getUserMedia)
# open  http://localhost:8000/harness/camera.html
```

`getUserMedia` → `<canvas>` → `decode()` per frame, with a success banner and
diagnostics (frame size, decode ms, px/module, decoded version/EC, and **byte-exact
payload-match** against a selected corpus vector). Toggles for mesh and adaptive
binarization. Pick `qr_worst…` (v40) in the *expected* dropdown.

The acid test: point the reference webcam (Framework 13 1080p) at the **printed**
`qr_worst_2of3_fullkey_ECL` (v40) and `qr_mid` (v37). Success = "MATCH ✓" in both
Chrome and Firefox. The committed PNGs are byte-identical to the sheets already
printed and verified with zxing-cpp, so reuse those printouts.

### Known browser gotchas
- **Firefox `resistFingerprinting`** farbles `canvas.getImageData` (corrupts
  readback) and historically limited JIT — both can specifically break a JS
  decoder. Test with it on and off; document. (banana_split hit this in 2022.)
- `file://` camera access: prefer Firefox; Chrome may require a served origin.

## The oracle

`test-vectors/build-manifest.mjs` decodes the corpus with **zxing-cpp (WASM)** to
(re)generate ground truth. Use it to regenerate `expected/` if you add vectors,
and as the known-good reference to compare quirc-mesh against. It is not part of
the shipped decoder — only the test fixture.
