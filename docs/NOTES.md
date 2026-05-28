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

---

## M2 — Mesh grid-sampling + version pinning (core IP; proven on synthetic)

New modules: `alignment.js` (locate all alignment patterns + 3 finder-derived corners),
`mesh.js` (Option A per-cell bilinear), `version_info.js` (version-info BCH). `sample.js`
gained `extractCodeMesh` (3x3 vote). `index.decode(img, {mesh=true})` selects the path.
New test `mesh.test.js` proves the IP; `npm test` is 16/16; clean harness stays 10/10.

- **The mesh works.** Under pure radial (non-projective) lens distortion, the mesh decodes
  high-version codes the single homography cannot — verified for **v25, v34, v37, and v40**
  (the AC-2 acid-test code). A single homography models any *flat perspective* exactly, so
  the distinguishing distortion in all synthetic tests is radial/curl, which is exactly what
  the alignment-pattern mesh corrects. `test/mesh.test.js` locks in v25/v34/v40 wins at
  k1=0.025 (single fails, mesh succeeds, byte-exact).
- **quirc's v21 apat is a typo (92, should be 94 = gridSize-7).** quirc tolerates it because
  apat only feeds fitness + the ±3 reserved-cell test; the mesh uses apat as EXACT anchors,
  so it broke clean v21. Fixed the value and added `alignmentPositions(v)` (canonical ISO
  algorithm, with the v32 step=26 special case) as the authoritative source; a unit test
  asserts the whole table matches it. The mesh and `reserved_cell` now use spec-correct
  positions.
- **Mesh construction (Option A).** Control grid = apat x apat (N x N). Its three corners
  (0,0),(N-1,0),(0,N-1) always coincide with the finders (apat[N-1]==gridSize-7), so those
  control points come from the finders' own 7x7 perspectives at module-center local coords
  (e.g. TL = `perspectiveMapF(caps[1].c, 6.5, 6.5)`). Interior + bottom-right nodes are
  located by image search; missing ones filled by the parallelogram rule
  `AP(i-1,j)+AP(i,j-1)-AP(i-1,j-1)` (zxing-cpp's trick), then global transform as last resort.
  Border modules (outside the outer apat lines) extrapolate from the nearest cell.
- **Alignment search params:** window ±2 modules around the coarse-transform guess; accept a
  candidate at score >= 14/17 on the concentric 5x5 profile (center dark, ring-1 light,
  ring-2 dark); refine to the centroid of the dark center module. Tunable in `alignment.js`.
- **Version-info BCH (addition over stock quirc).** `measure_grid_size` drifts under
  distortion and returned wrong sizes (v25->121, v34->157, v37->169) — fatal for both paths.
  `refineVersion` rebuilds the perspective for candidate versions near the estimate, reads
  the two 18-bit version blocks (ISO order, matching ZXing) and BCH-decodes (Hamming<=3) to
  PIN the true version, correcting gridSize + perspective. This unlocked the v25/v34/v37
  mesh wins above. BCH generator 0x1f25; verified encode(v7)=0x07C94.
- **Open limiter -> M3: quirc's detection/grouping is fragile under distortion** (and
  non-monotonic in distortion strength — e.g. k1=0.01 can fail where 0.015 succeeds). When a
  grid IS detected, mesh+version-info decode it correctly even where single fails; when
  detection yields 0 grids, nothing downstream can help. Making the finder/grouping robust
  (and adaptive binarization for camera lighting) is the M3 critical path, validated
  ultimately by the physical camera test.

---

## M3 — Camera robustness + synthetic proof (in progress)

Built so far: local adaptive binarizer, the camera harness, and a 3-way synthetic
comparison. The detection-robustness engineering and the physical acid test remain.

- **Local adaptive binarizer** (`binarize.binarizeAdaptive`, after ZXing's
  HybridBinarizer: 8x8 blocks, per-block black point from a 5x5 neighbourhood of block
  averages, low-contrast blocks defer to neighbours). Opt-in via `decode(img,{adaptive:true})`;
  global Otsu stays the default so clean stays byte-exact (10/10). On the current synthetic
  set it did **not** beat global Otsu (those images have near-uniform lighting; the gradient
  is mild). It's expected to matter for *real* camera shadows/gradients — keep it, validate on
  the physical test.
- **Camera harness** `harness/camera.html` + `harness/serve.mjs` (`npm run serve` ->
  http://localhost:8000/harness/camera.html). getUserMedia -> canvas -> `decode()` per frame;
  success banner, diagnostics (frame size, decode ms, px/module from corners, version/EC), and
  **byte-exact match** against a corpus vector chosen from a dropdown. Toggles for mesh +
  adaptive. Includes a resistFingerprinting canvas-readback hint. Smoke-tested: server serves
  ES modules with correct MIME; getUserMedia itself needs a real browser (user runs it).
- **Synthetic finding: detection is the dominant limiter.** `npm run synth` over 45 degraded
  vectors: detection finds a grid in only ~20/45; among those, mesh decodes more than single
  (mesh 6 vs single 3 overall). So quirc's finder/grouping fragility — not sampling — is now
  the bottleneck, and it's non-monotonic in distortion strength. NOTE the current generator
  levels (esp. moderate/strong: heavy combined blur+noise+radial+perspective) are likely
  HARSHER than a flat printed sheet held to a webcam (the real acid test, which zxing-cpp
  passes), so the synthetic detection rate is a pessimistic proxy.
- **Open M3 work:** (1) finder/grouping robustness under distortion (the real critical path —
  candidate directions: more tolerant grouping geometry, multi-threshold detection passes,
  zxing-style finder grouping); (2) the **physical camera acid test** (user-run, Framework 13,
  Chrome+Firefox, printed v40/v37) — the ground-truth validator that also tells us whether the
  synthetic is representative.

### M3 update — AC-2 PASSED on real hardware + freeze fixes

- **AC-2 met (user-confirmed 2026-05-28).** The printed v40 (`qr_worst`) reads from the
  Framework 13 1080p webcam in **both Chrome and Firefox**, byte-exact, across **3.4–5.0
  px/module**. v37 and v10 also decoded (they showed "≠ expected" only because the v40 vector
  was selected in the dropdown — real reads, RS-validated, so AC-4 holds). The mesh works on
  the real acid test, not just synthetic. This is the make-or-break criterion.
- **Browser freeze on large/close codes — root-caused and fixed.** Reproduced in Node only
  once the frame had camera-like clutter (dark "hand" blobs + sensor noise):
  - *Crash:* `buildControlGrid` indexed `VERSION_DB[version]` for an out-of-range version →
    guarded (version 2..40, integer).
  - *Freeze (1653 ms):* noise spawns up to MAX_CAPSTONES(32) false finders → bogus grids with
    versions **v49–v153**; `jiggle_perspective`/`fitness_all` then churn over those giant grid
    sizes. Fix: reject implausible grids (version <1 or >40) in `record_qr_grid` **before** the
    expensive jiggle. Result: **1653 ms → 145 ms**, bogus grids gone.
  - *"Aw snap" (OOM):* the JS flood-fill had no depth bound (I'd dropped quirc's fixed stack).
    Restored a generous depth cap (`max(512, 2*h)`) so giant clutter regions can't grow the
    frame stack without limit (mirrors quirc's "stack overflow -> just stop").
  - `camera.html`: split into an rAF preview loop + a **throttled, non-overlapping** decode
    loop that yields between runs, so a heavy frame can't make the page unresponsive. Kept
    **full resolution — NOT downscaled**, because v40 sits near the px/module limit (the user's
    reads were 3.4–5.0 px/mod; downscaling 1920->1280 would drop v40 below the decode floor).
  - Guarded by `test/robustness.test.js` (noise/blank -> null; cluttered v40 -> correct-or-null,
    bounded < 1.5 s). Suite now 19/19; clean 10/10 unchanged.

---

## M5 — Benchmark & JS-vs-WASM decision (done; AC-6)

`harness/bench.mjs` (`npm run bench`) times per-frame decode over the clean corpus, quirc-mesh
(pure JS) vs zxing-cpp (WASM), median/p90. The v40 PNG is 1480x1480 (~2.2 MP ≈ a 1080p frame),
so it tracks the camera worst case.

Node v22.22.2, 40 iters, median/p90 ms:

| version | quirc-mesh JS | zxing-cpp WASM |
|---|---|---|
| v7  | 5.5 / 5.8   | 1.1 / 1.3  |
| v17 | 13.1 / 14.7 | 4.0 / 4.5  |
| v25 | 22.4 / 24.3 | 7.4 / 8.1  |
| v34 | 35.2 / 37.1 | 12.2 / 13.4 |
| v37 | 42.2 / 45.4 | 14.8 / 15.5 |
| **v40** | **46.5 / 48.6** | **16.6 / 17.7** |

Both decode 10/10 of the clean corpus (success parity). In-browser (user, Framework 13, live
camera, mesh + adaptive) v40 measured ~42-46 ms/frame in both Chrome and Firefox — consistent
with Node, so adaptive-binarizer overhead is negligible.

**DECISION: ship PURE-JS, no WASM.** v40 p90 is **~49 ms** — roughly **20x under** the ~1 s/frame
responsiveness bar (a scanning loop locks on in 1-2 frames). Pure JS is ~2.8x slower than the
WASM blob, but that's irrelevant at this scale, and it eliminates the opaque-blob
provenance/audit problem entirely (PRD §2.1 — the whole point of the project). WASM stays a
documented contingency only; not needed.

---

## M4 — Fail-closed hardening (done; AC-4)

The property for a backup tool: **null or the exact correct payload, never a wrong one.**

- **Emit-path audit (single RS gate).** `decode`/`decodeAll`/`decodeDebug` only build a result
  from the `data` returned by `tryDecode`, which returns null unless `decodeCode` is SUCCESS.
  `decodeCode` returns data only if (a) `readFormat` BCH validates, (b) `codestreamEcc` succeeds
  — and `correctBlock` re-checks the RS syndromes *after* correction, returning DATA_ECC on any
  residual — and (c) `decodePayload` succeeds. There is **no path that emits a result without RS
  success.** Version-info BCH (Hamming<=3, either copy) only sets the grid size; a false version
  makes RS fail, it can't by itself produce a payload.
- **Fuzz measurement** (`harness/fuzz.mjs`, `npm run fuzz`): **900 trials → 0 wrong reads.**
  Pixel-corruption sweeps (2-50%) on v10/v25/v40 degrade gracefully (correct -> null, never
  wrong); pure noise yields **0** false-positive decodes; crops (40/60/80%) yield 0 wrong. Locked
  a bounded version into `test/failclose.test.js` (suite now 21/21).
- **Residual theoretical risk:** an RS false-accept (errors beyond correction capacity aliasing
  onto another valid codeword) could in principle emit garbage bytes. Not observed in 900 trials;
  QR's RS minimum distance makes it astronomically unlikely; and Banana Split's wire format has
  its own authenticated-integrity backstop above the QR layer (PRD / ALGORITHM.md §6). We do not
  add structural gates that would trade recall for a risk RS already covers.
