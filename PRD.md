# quirc-mesh — Product Requirements

## 1. Problem

A class of QR decoders reads dense (high-version) codes fine from clean digital images but **fails to read them from a camera**. This blocks [Banana Split](https://github.com/paritytech/banana_split) v2, which needs to scan QR shards that reach **v37–v40** (165×165–177×177 modules) when a shard carries a large secret (e.g. a deflated 4096-bit GPG key fragment). See `docs/PRIOR_ART.md` for the measured evidence and root cause.

Root cause (confirmed in source — see `docs/PRIOR_ART.md`): `jsQR`, `zxing-js`, and **quirc** all build **one** perspective transform from the 3 finder patterns + **at most one** alignment pattern, then sample every module through it. High-version codes carry many alignment patterns (v40: ~46) specifically because a single homography cannot model the lens/paper distortion across a large code. The accumulated grid drift makes cells misread; Reed–Solomon then fails. `zxing-cpp` succeeds because its detector samples **piecewise over the full alignment-pattern mesh** — but it ships to browsers only as a ~1 MB opaque WASM blob.

## 2. Goal

A **small, auditable QR decoder** that reads v1–v40 codes **from a webcam**, matching `zxing-cpp`'s real-world capability on our corpus, while being:

- **Auditable**: on the order of quirc's size (~3–4 kLOC), readable end-to-end.
- **Ideally pure JavaScript** (no WASM) — so Banana Split needs **no binary blob** at all. WASM (compiled from the same fork) is the *fallback* only if pure-JS is too slow.
- **Self-owned / supply-chain-resistant**: vendored, pinned, no heavyweight dependencies.

### 2.1 Why pure-JS is the prize

Banana Split recovery is a **one-shot scan**, not real-time AR. We do not need 30 fps. If a pure-JS decoder reads the worst v40 in even a few hundred ms per frame, that is entirely acceptable for recovery — and it eliminates the WASM provenance problem (no opaque blob to audit/reproduce). This is strictly the best outcome for a security tool that must be trustworthy decade-over-decade. The benchmark in `docs/BENCHMARK_PLAN.md` decides JS vs WASM.

## 3. Users / consumers

1. **Banana Split v2** (primary): imports quirc-mesh as the recovery-path QR reader. Generation/printing is unaffected (Banana Split already generates codes; we only need *decode*).
2. **The wider community** (secondary): anyone hitting the "v20+ fails silently from camera" wall. Worth releasing standalone.

## 4. Scope

### In scope
- **Decode only.** Detection + bit extraction + de-mask + Reed–Solomon + data decoding for **standard QR, versions 1–40**, from a grayscale/RGBA raster (camera frame or PNG).
- The **mesh grid-sampling** improvement over quirc (the core work — see `docs/ALGORITHM.md`).
- Modes we actually emit: **alphanumeric** (base45 payloads) and **byte**; numeric is cheap to keep. ECI/Kanji/structured-append are optional.
- A JS API that takes `ImageData`/`{data,width,height}` and returns `{text, bytes, version, ecLevel, ...}` or a structured failure.

### Out of scope (non-goals)
- **Encoding / QR generation** — Banana Split uses a separate generator; we control the codes we read.
- **Micro QR, rMQR, Aztec, DataMatrix, 1D barcodes** — QR only.
- **Real-time / high-FPS AR scanning**, multi-code-per-frame throughput optimization.
- **Adversarial / artistic / heavily-damaged codes** beyond normal print+camera wear. (We control generation, so we can assume standard, well-formed, decent-contrast codes. See §6.)
- Reading codes we did not generate with exotic encodings.

## 5. Success criteria (acceptance tests)

Let the corpus be `test-vectors/` (10 vectors, ground-truth payloads in `expected/`, indexed by `manifest.json`).

**AC-1 — Clean-image correctness (regression).**
Decode every PNG in `test-vectors/images/` and reproduce its `expected/<name>.txt` **byte-for-byte**, for v7 through **v40**. This is the table-stakes gate; even stock quirc may pass some rungs, but it must hold across the whole ladder.

**AC-2 — Camera read of the worst v40 (the real goal).**
Reading the **printed** `qr_worst_2of3_fullkey_ECL.png` (v40, EC-L) from a commodity webcam (reference: Framework 13 built-in, 1080p) at ~100% print zoom yields the exact expected payload, in **both Chrome and Firefox**. This is the test stock quirc/jsQR/zxing-js fail and zxing-cpp passes. **quirc-mesh must pass it.**

**AC-3 — Camera read of v37** (`qr_mid_3of5_fullkey_ECM.png`) under the same conditions.

**AC-4 — No silent wrong reads.**
The decoder must **never** return a confidently-wrong payload. A misread that passes internal checks and yields wrong bytes is catastrophic for a backup tool. Rely on Reed–Solomon integrity (and the format-CRC) to fail closed: prefer "no result" over a wrong result. Add a negative test: feed corrupted/garbage images and assert no false-positive decode.

**AC-5 — Size/auditability.**
Total decoder source stays small (target ≤ ~4 kLOC, no heavy deps). A reviewer can read the whole thing.

**AC-6 — Performance (informs JS-vs-WASM, not pass/fail by itself).**
Per-frame decode latency on the reference laptop is recorded for the v40 case. Threshold for "pure-JS is good enough to ship without WASM": see `docs/BENCHMARK_PLAN.md` (target: usable one-shot scan, i.e. well under ~1 s/frame so a scanning loop feels responsive).

## 6. Assumptions we may exploit (because we control generation)

These let us avoid the hardest parts of general-purpose CV:

- Codes are **standard QR** (not Micro), versions 1–40, generated by a known-good encoder.
- **Good contrast, modest skew** — a user holding a printed sheet to a webcam, not a crumpled receipt at 60°.
- We may, if helpful, influence Banana Split's *print* template later (quiet-zone width, module size guidance, even fiducials) — but **do not require** generator changes for v1; the printed vectors here use a standard 4-module quiet zone.
- Payloads are **alphanumeric base45** (current v2 choice) or byte. The decoder should not hard-code this, but it can be the optimization target.

## 7. Constraints

- **License**: ISC/MIT, preserving quirc's notice.
- **No network, no telemetry**; runs fully offline (it's a recovery tool).
- **Deterministic**: same input ⇒ same output.
- **Browser + Node**: must run in-browser (Banana Split is a static page) and in Node (for the test harness/oracle).

## 8. Risks

- **R1 — Mesh sampling is harder than estimated.** quirc already finds finders/alignment patterns and does RS; the new work is locating *all* alignment patterns reliably and building the sampling mesh. Estimate: a few hundred to ~1k LOC, plus tuning. Mitigation: validate on clean images first (AC-1), then camera (AC-2).
- **R2 — Pure-JS too slow.** Mitigation: the WASM fallback (compile the same fork via Emscripten); the algorithm is identical, only the runtime differs. Decide via `docs/BENCHMARK_PLAN.md`.
- **R3 — Correctness regressions / silent misreads (AC-4).** Mitigation: RS + CRC fail-closed, negative tests, never trust a low-confidence sample.
- **R4 — Camera variance** (different webcams, lighting). Mitigation: the reference hardware (Framework 13 1080p) is deliberately a *worst-case* built-in cam; passing it implies headroom on better cameras. Record results per device.

## 9. Definition of done (v1)

AC-1 through AC-5 pass; AC-6 measured and the JS-vs-WASM decision recorded; a short README usage example; the fork published (or ready to publish) as a standalone ISC repo; Banana Split can import it for its recovery path.
