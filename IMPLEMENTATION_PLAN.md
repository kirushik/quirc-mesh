# Implementation plan

Phased so each milestone produces a runnable, testable artifact. Default to a
**JS-first** implementation (rationale in `PRD.md` §2.1 and `docs/ALGORITHM.md`
§7). The WASM path is a contingency, not the default.

Read `docs/ALGORITHM.md` first — it defines the actual work. This file is the
sequencing and the "where to start."

---

## Milestone 0 — Harness & oracle (½ day)

Goal: a red test you can make green, plus a trusted reference.

- `npm install` (deps already declared in `package.json`: `pngjs`, `zxing-wasm`,
  a test runner). Note: install may need `--cache ./.npm-cache` and
  `--legacy-peer-deps` in restricted environments (that's what banana_split's
  scratch used).
- Confirm the **oracle** works: `node test-vectors/build-manifest.mjs` (run from a
  dir with the deps) re-derives `expected/*.txt` + `manifest.json` via zxing-cpp.
  These are ground truth.
- Stand up `harness/run.mjs` (skeleton in `harness/`): load `manifest.json`, decode
  each image with `src/index.decode()`, diff against `expected/<name>.txt`, print a
  pass/fail table. Initially everything fails (no decoder yet) — that's the target.

**Exit:** `node harness/run.mjs` runs and reports 0/10 with a stubbed decoder.

---

## Milestone 1 — Port quirc's reused pipeline to JS (2–4 days)

Goal: a working **single-homography** JS decoder (i.e. quirc-equivalent). This
re-establishes the baseline and gives you all the reused machinery before the
mesh work.

Port, in order (see `reference/quirc/lib/`, module map in `ALGORITHM.md` §8):
1. `version_db.js` — transcribe `version_db.c` (alignment coords + EC block table).
   Add a unit test against a few spec-known versions (v1,v7,v40 module count,
   alignment coords).
2. `perspective.js` — `perspective_setup/map/unmap` (pure math, direct port).
3. `binarize.js` — adaptive threshold (port quirc's threshold).
4. `finder.js` — capstone detection, grouping, `measure_grid_size` (port `identify.c`
   detection half).
5. `format.js`, `rs.js`, `decode.js` — format/version decode, GF(256) RS, demask,
   deinterleave, segment decode (port `decode.c`).
6. `sample.js` — at first, the **single global transform** (quirc's `read_cell`).
7. `index.js` — wire it together.

**Exit (AC-1 partial):** clean-image decode passes the **low/mid** rungs
(v7–v25ish) — matching stock quirc. High rungs (v34–v40) may still fail from the
*camera* later, but clean PNGs of them should mostly pass even single-homography.
Validate with `harness/run.mjs` against the clean corpus.

> Shortcut option: instead of hand-porting, you *could* compile quirc to WASM as
> the Milestone-1 baseline and only write steps 5–7 of the algorithm fresh. But
> since the end goal is likely pure-JS, hand-porting now pays off. Decide early.

---

## Milestone 2 — Mesh grid-sampling (the core, 3–6 days)

Goal: implement `docs/ALGORITHM.md` steps 5–7. This is the IP.

1. `alignment.js` — generalize quirc's `find_alignment_pattern` to locate **every**
   alignment pattern from `version_db` coords, using the coarse transform for
   initial guesses + a small search window. Return found pixel centers; tolerate
   misses; reject outliers.
2. `mesh.js` — build the mesh (Option A: per-cell bilinear) from finder corners +
   found alignment centers. Implement `map(moduleX, moduleY) -> pixel`.
3. `sample.js` — switch matrix extraction to the mesh map (with a 3×3 voting
   window). Keep the single-homography path as a fallback for v≤6 (no/one
   alignment pattern) and as a comparison baseline.

**Exit (AC-1 full):** every clean image v7–**v40** decodes correctly via the mesh
path (`harness/run.mjs` → 10/10 on clean images).

---

## Milestone 3 — Camera path & the acid test (2–4 days)

Goal: pass AC-2/AC-3 — read the **printed** v40/v37 from a webcam.

- Build `harness/camera.html`: getUserMedia → canvas → `src/index.decode()` per
  frame, with on-screen success feedback and the diagnostics the banana_split
  PoC had (px/module, decode ms, payload match vs `expected/`). Mirror
  `banana_split/_scratch/bananasplit-wasm-acidtest.html` for the UX so results are
  comparable.
- Single self-contained file is nice-to-have (base64-inline assets) so it opens
  from `file://` — but for dev, a tiny static server is fine.
- Test on the reference Framework 13 1080p webcam against the **reusable printed
  sheets** (the vectors here are byte-identical to what was printed).
- Tune: binarization for camera noise, search-window size, voting window, minimum
  alignment-pattern coverage. This is where real-world robustness is won.

**Exit:** the printed `qr_worst_2of3_fullkey_ECL` (v40) and `qr_mid` (v37) decode
from the webcam in Chrome **and** Firefox, exact payload match. (Side-by-side
against the zxing-cpp PoC, which is the known-good reference.)

---

## Milestone 4 — Hardening & correctness (1–2 days)

- AC-4 negative tests: noise/garbage/cropped images ⇒ assert **no** decode.
- Fuzz the sampler with synthetic perspective/noise to find silent-misread paths.
- Confirm RS + format BCH fail closed; never emit a result without RS success.
- Decode-time stability across many frames; no crashes on malformed input.

---

## Milestone 5 — Benchmark & the JS-vs-WASM decision (1 day)

Run `docs/BENCHMARK_PLAN.md`. Measure pure-JS per-frame latency on the reference
laptop for the v40 case; compare to the zxing-cpp WASM baseline.

- **JS fast enough** (usable one-shot scan) → ship **pure-JS**, no WASM. Best
  outcome. Done.
- **JS too slow** → compile the *same* fork (steps 5–7 in C atop quirc) via
  Emscripten; set up the reproducible, provenance-stamped build (pin emsdk,
  `SOURCE_DATE_EPOCH`, embed source sha256/IPFS-CID). Ship that as the official
  WASM artifact.

**Exit (AC-6):** decision recorded with numbers.

---

## Milestone 6 — Package & integrate (1 day)

- Public API + README usage example; ESM build that runs in browser and Node.
- Publish as a standalone ISC repo (preserve quirc's notice; see
  `reference/quirc/LICENSE` and `reference/quirc/PROVENANCE.md`).
- Wire into Banana Split's v2 **recovery** path (generation untouched). Coordinate
  with `banana_split/V2_DESIGN.md` §8.3.

---

## Estimates (rough, single developer)

| milestone | est. |
|---|---|
| M0 harness | ½ d |
| M1 port quirc → JS | 2–4 d |
| M2 mesh sampling | 3–6 d |
| M3 camera + acid test | 2–4 d |
| M4 hardening | 1–2 d |
| M5 benchmark/decision | 1 d |
| M6 package/integrate | 1 d |

The honest critical path is **M2 (mesh) + M3 (camera tuning)** — that's the novel,
risk-bearing work. M1 is mechanical. Don't let "a couple hours to port 3 kLOC"
optimism hide that the value is entirely in M2–M3.

## First action

Do M0, then start M1 with `version_db.js` + its spec test. Keep
`harness/run.mjs` green-tracking from the first commit.
