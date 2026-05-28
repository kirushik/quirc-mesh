# quirc-mesh

A small, auditable QR-code **decoder** that can read **high-version (v20–v40) codes from a webcam** — the case where `jsQR`, `zxing-js`, ZBar, and stock `quirc` all fail silently.

It is a fork of [dlbeer/quirc](https://github.com/dlbeer/quirc) (ISC, ~3 kLOC) that replaces quirc's single global perspective transform with **piecewise grid sampling over the full mesh of alignment patterns** — the technique that makes `zxing-cpp` succeed where the small libraries fail.

Target consumer: **[Banana Split](https://github.com/paritytech/banana_split)** v2, a Shamir-secret-sharing paper-backup tool that needs to scan dense QR shards (up to a full 4096-bit GPG key) during recovery, while keeping its bundle tiny and fully auditable (no opaque WASM blob). See `docs/PRIOR_ART.md` for the full backstory.

## Why this exists (one paragraph)

Banana Split's v2 format can pack large secrets into single QR codes per shard, but those codes reach v37–v40 (165×165–177×177 modules). Every pure-JS decoder we tried reads such codes fine from a *clean PNG* but **fails from a camera**, because they map the whole code with one homography anchored on 3 finder patterns + at most one alignment pattern. A v40 code carries ~46 alignment patterns precisely because one homography cannot survive lens/paper distortion across that span. `zxing-cpp` (C++→WASM) is the only engine we found that reads our worst v40 from the laptop webcam — but it's a ~1 MB opaque blob. quirc-mesh aims to deliver the same capability in a tiny, auditable codebase, **ideally in pure JS so no WASM is needed at all**.

## Usage

```js
import { decode } from "quirc-mesh";

// imageData: { data: Uint8ClampedArray (RGBA), width, height }
// e.g. canvas.getContext("2d").getImageData(...) in a browser, or pngjs in Node.
const result = decode(imageData);
if (result) {
  console.log(result.text, "v" + result.version, result.ecLevel);
} else {
  // no decode — fail-closed: quirc-mesh returns null rather than a wrong payload
}
```

Options — `decode(imageData, { mesh, adaptive })`:
- **`mesh`** (default `true`): piecewise alignment-pattern mesh sampling — the
  high-version-from-camera capability. `false` falls back to a single homography (quirc-equivalent).
- **`adaptive`** (default `false`): local block binarization for uneven lighting. Enable for
  **webcam** frames; leave off for clean scans (global Otsu is exact there).

Returns `{ text, bytes, version, ecLevel, mask, dataType, eci, corners }` or `null`. Also exported:
`decodeAll` (all codes in a frame) and `decodeDebug` (adds detection diagnostics). Pure ESM, runs
in browsers and Node ≥18, **no runtime dependencies, no WASM**. Live webcam demo: `harness/camera.html`
(`npm run serve`).

## Start here (reading order)

1. **`PRD.md`** — what we're building, goals, non-goals, success criteria, acceptance tests.
2. **`docs/PRIOR_ART.md`** — why the small libs fail, why zxing-cpp wins, links + the exact quirc code that's the problem.
3. **`docs/ALGORITHM.md`** — the mesh-sampling algorithm in detail (the actual work).
4. **`IMPLEMENTATION_PLAN.md`** — phased plan, milestones, where to start coding.
5. **`docs/BENCHMARK_PLAN.md`** — the JS-vs-WASM decision and how to measure it.

## What's in this bundle

```
quirc-mesh/
├── README.md                 ← you are here
├── PRD.md                    product requirements + acceptance criteria
├── IMPLEMENTATION_PLAN.md    phased build plan
├── package.json              deps for the harness/oracle (not yet installed)
├── docs/
│   ├── PRIOR_ART.md          why existing decoders fail; references; prior art
│   ├── ALGORITHM.md          mesh grid-sampling design (the core IP)
│   └── BENCHMARK_PLAN.md     JS-native vs WASM benchmark + acceptance thresholds
├── reference/quirc/          PINNED quirc source (ISC) — read identify.c/decode.c
│   ├── lib/*.c, *.h          the code we're forking
│   ├── LICENSE               ISC
│   └── PROVENANCE.md         commit + sha256 of every vendored file
├── test-vectors/
│   ├── images/               the QR PNGs (incl. PRINTED v37/v40 — reuse for camera tests)
│   ├── expected/<name>.txt   exact decoded payload each image MUST yield (byte-for-byte)
│   ├── manifest.json         index: file, sha256, version, modules, EC, charCount
│   ├── gen-sample-qr.js      regenerates the 3 named vectors (qrcode lib)
│   └── build-manifest.mjs    re-derives expected/* + manifest.json via zxing-cpp oracle
└── harness/                  validation harness skeleton (clean-image + camera PoC)
    └── README.md
```

## The acid test (the whole point)

`test-vectors/images/qr_worst_2of3_fullkey_ECL.png` is a **v40, EC-L** code (177×177 modules). Its decoded payload is in `test-vectors/expected/qr_worst_2of3_fullkey_ECL.txt`.

- The original author **printed this sheet at 100% zoom** (≈ ⅔ of an A4) and confirmed **zxing-cpp WASM reads it from the Framework 13's own 1080p webcam** (5.6 px/module, both Firefox & Chrome).
- The pure-JS decoders **fail the same sheet**.
- **quirc-mesh succeeds iff it reads that same printed sheet from a webcam, producing the exact expected payload.** That printout can be reused — the vectors here are byte-identical to it.

## Status

**Working pure-JS decoder** (`src/`). Acceptance criteria met:

- **AC-1** clean v7–v40 byte-exact — 10/10 (`npm run harness`).
- **AC-2** the printed **v40** reads from the Framework 13 1080p webcam in **Chrome and Firefox**,
  byte-exact, at 3.4–5.0 px/module (the case stock quirc/jsQR/zxing-js fail).
- **AC-4** fail-closed — **0 wrong reads across 900 fuzz trials** (`npm run fuzz`).
- **AC-5** ~1.9 kLOC, no runtime deps.
- **AC-6** pure-JS, **~49 ms/frame** p90 for v40 — ~20× under the responsiveness bar, so **no WASM**.

Unit + integration suite: `npm test` (21 tests). Full build log and every design decision are in
**`docs/NOTES.md`**. Remaining: optional finder-grouping robustness for extreme close-up/tilt, and
wiring into Banana Split's v2 recovery path.

## A note on git

This folder currently lives inside the `banana_split` working tree as an untracked subfolder. It is intended to become its **own standalone repository** (it's independently useful and cleanly ISC-licensable as a quirc fork). Decide repo layout before committing; don't accidentally commit it into `banana_split`.

## License

Derives from quirc (ISC). Keep the fork ISC (or MIT) so it stays freely reusable. Preserve quirc's copyright notice (see `reference/quirc/LICENSE`).
