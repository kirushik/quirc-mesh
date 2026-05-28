# Implementation notes — assumptions & design decisions

A living, append-only log of every non-obvious assumption and design decision, so anything
can be traced / audited / revisited later. Format per entry: **Decision → Why → Alternatives
→ How to revisit.** Newest milestone appended at the bottom.

Reading order for the project: `README.md` → `PRD.md` → `docs/PRIOR_ART.md` →
`docs/ALGORITHM.md` → `IMPLEMENTATION_PLAN.md` → `docs/BENCHMARK_PLAN.md`. This file records
*choices made while building*, not the spec.

---

## Cross-cutting decisions (locked at planning)

- **Pure-JS first, WASM only as contingency.** The decoder is hand-ported JS; the C in
  `reference/quirc/` is read-only reference, never compiled into the shipped artifact unless
  M5 benchmarks force it. Rationale: PRD §2.1 (no opaque blob to audit). Single source of
  truth — never dual-maintain C and JS. Revisit only if M5 shows v40 ≫ ~1 s/frame.
- **Local adaptive binarizer from the start.** quirc ships only global Otsu
  (`identify.c:291`), which cannot handle shadows/gradients; ZXing's camera success leans on
  a local (block-based) binarizer. We keep global Otsu for clean images and add a block-based
  adaptive path for camera. Cost ~100–200 LOC, within the ≤4 kLOC budget (AC-5).
- **Mesh = piecewise sampling over all alignment patterns.** Replaces quirc's single
  homography (`identify.c:850` + `:690`). Start with **Option A** (per-cell bilinear); keep
  the `mesh.map()` API drop-in so **Option B** (per-tile homography, zxing-cpp's proven
  method) can replace it if A underperforms. Missing alignment patterns filled by the
  parallelogram rule `AP(x-1,y)+AP(x,y-1)-AP(x-1,y-1)` and neighbor regression-line
  intersection (zxing-cpp `QRDetector.cpp`).
- **Version-info BCH for v≥7 (addition over stock quirc).** quirc derives version purely from
  the geometric `measure_grid_size`; off-by-one-step on a v40 camera read = total failure.
  We additionally read the two 18-bit version blocks and correct to the nearest valid string
  (Hamming ≤3) to pin the version. Revisit if it ever fights the geometric estimate.
- **Synthetic-distortion harness is independent of `src/`.** The generator
  (`harness/gen-distorted.mjs`) must share no code with the decoder, so it is a real test of
  the decoder, not a tautology. Randomness lives only in the harness (seedable); `src/` is
  deterministic (PRD §7).

## Porting subtleties (apply during M1)

- **EC-level integer mapping:** quirc internal order is **M=0, L=1, H=2, Q=3** (`quirc.h`).
  Preserve this through format decode; convert to letters only at the API boundary. Ground
  truth `expected/*` + manifest use letters L/M/H.
- **Alphanumeric mode == base45 alphabet:** `decode.c` `alpha_map` is exactly
  `"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"` (the base45 alphabet). So the QR-layer
  alphanumeric text **is** the `expected/*.txt` string — no separate base45 step at the QR
  layer. (Banana Split's base45 *content* decode happens above us.)
- **No trailing newline:** `expected/*.txt` have none; `harness/run.mjs` does strict `===`.
  `index.js` must return `text` with no appended newline. (README: the only historical diff
  was a stray trailing newline.)
- **Region labels:** use a separate `Uint8Array` (0=white, 1=black, 2..255=region; ≤254
  regions) rather than quirc's image/pixel buffer-aliasing trick.
- **Flood fill iterative:** port quirc's span-based flood fill as an explicit
  loop/stack (it already is — `flood_fill_seed`), never recursion, to survive large camera
  frames.
- **Grayscale first:** convert RGBA→luma before binarizing. Webcam frames are low-contrast at
  distance; the binarizer must not assume crisp input.

---

## M0 — Harness, oracle, notes (done)

- **Environment:** Node v22.22.2, npm 10.9.7. `npm install --legacy-peer-deps --cache
  ./.npm-cache` succeeded (pngjs 7.x, zxing-wasm 1.3.5 + 1 dep).
- **Oracle API drift fixed.** `package.json` pins `zxing-wasm@^1.0.0` but the installed 1.3.5
  renamed the reader entry point. Updated `test-vectors/build-manifest.mjs`:
  `readBarcodes` → **`readBarcodesFromImageData`**, and result field `r.ecLevel` →
  **`r.eccLevel`**. Dropped the no-longer-needed `tryDownscale` option.
  - **Why pin still says ^1.0.0:** left as-is for now; the oracle is a dev-only fixture, not
    shipped. Revisit when we lock dev deps for release (M6) — consider pinning the exact
    zxing-wasm version so ground-truth regeneration is reproducible.
- **Oracle confirmed idempotent.** Re-running `build-manifest.mjs` regenerates `expected/*`
  and `manifest.json` **byte-identical** to the committed ground truth (no git diff). The
  ground truth is therefore reproducible from the PNGs via the zxing-cpp oracle. Coincidence
  noted: `generatedAt` = today (2026-05-28) matches the committed value, so manifest.json is
  stable today; on a future regen that date field will differ (expected, harmless).
- **Red test confirmed:** `node harness/run.mjs` → **0/10** (no `src/index.js` yet). This is
  the target to turn green: low/mid rungs at M1, all 10 incl. v37/v40 at M2.
- **Wasm reader path:** `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` (used by the
  oracle and, later, the camera-harness side-by-side baseline).

---

## M1 — quirc pipeline ported to JS (done; AC-1 fully met)

Modules: `errors, perspective, version_db, gf, rs, binarize, region, finder, sample,
decode, index`. Unit tests: `version_db`, `rs` (GF inverses + independent BCH(15,5)
encoder feeding `correctFormat`), `perspective` (corner mapping + map∘unmap identity).
Run units with `npm test`; clean-image integration with `npm run harness`.

- **Region label width is the real high-version blocker, NOT sampling drift.** Stock quirc
  caps regions at 254 (a `uint8` label-map limitation). Dense v30-v40 codes create >254
  black connected-components *before the third finder is labeled*, so detection finds only 2
  capstones → 0 grids → no decode. Verified: v40 created exactly 254 regions, 2 capstones.
  **Fix:** `binarize` returns a `Uint16Array` label/pixel buffer and `region.MAX_REGIONS` =
  65534 (quirc's own internal `uint16` branch). After this, clean v40 detects + decodes.
  - **Consequence for the project thesis:** on *clean, rectilinear* images a single
    homography (+ quirc's jiggle) is sufficient through v40 — `harness/run.mjs` is **10/10**
    at M1, so **AC-1 is already met before the mesh exists.** The mesh (M2) is therefore
    needed *specifically* for camera/perspective distortion (AC-2/AC-3), which is exactly
    what PRIOR_ART predicted. This reframes M2's clean-image exit as already-satisfied; the
    mesh's value must be proven on the **synthetic-distortion** harness (built early in M2 as
    the red target) and the physical camera test.
- **rint vs Math.round:** `perspective.rint` implements round-half-to-even to match C's
  `rint()`; ordinary `Math.round` ties differently and could shift a sampled pixel by 1.
- **EC level reported as a letter** (`ECC_LETTER[eccLevel]`) at the API; internally the M=0,
  L=1, H=2, Q=3 integer order is preserved end-to-end.
- **Mirror retry:** `decode()` retries a transposed matrix (quirc_flip) if the first parse
  fails — cheap insurance for mirrored captures. Not exercised by the clean corpus.
- **`node --test` needs file globs** (`test/*.test.js`), not a bare `test/` dir, on Node 22.
- **Clean-image latency (Node, informational):** ~8-33 ms/decode v7-v40. Comfortably within
  the AC-6 budget; real measurement is the camera path (M5).
