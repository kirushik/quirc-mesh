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

## Camera — `camera.html` (Milestone 3, to build)

A browser page: `getUserMedia` → `<canvas>` → `decode()` per frame, with on-screen
success feedback and diagnostics (px/module, decode ms, payload-match vs
`expected/`). **Model it on
`banana_split/_scratch/bananasplit-wasm-acidtest.html`** so results are directly
comparable to the zxing-cpp baseline (same layout, same counters).

The acid test: point the reference webcam (Framework 13 1080p) at the **printed**
`qr_worst_2of3_fullkey_ECL` (v40) and `qr_mid` (v37). Success = exact payload match
in both Chrome and Firefox. The committed PNGs are byte-identical to the sheets
already printed and verified with zxing-cpp, so reuse those printouts.

Nice-to-have: a single self-contained file (base64-inline the decoder + sample
thumbnails) so it opens from `file://` with no server — that's how the banana_split
PoCs were delivered. For day-to-day dev a tiny static server is fine.

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
