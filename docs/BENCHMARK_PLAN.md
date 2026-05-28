# Benchmark plan — JS-native vs WASM

The deliverable of this benchmark is a **decision**: ship pure-JS (no blob) or
ship a self-built WASM. Pure-JS is preferred (no opaque artifact to audit); WASM
is justified only if pure-JS is too slow for a usable one-shot recovery scan.

## What we're measuring

Recovery is a **one-shot scan**, not real-time AR. The relevant question is:
"when a user holds a printed shard to the webcam, does it lock on quickly enough
to feel responsive?" So measure:

1. **Per-frame decode latency** (ms) for the worst case (v40, `qr_worst`), on a
   1080p frame, on the **reference hardware (Framework 13 built-in webcam)**.
   Report median + p90 over ≥100 frames.
2. **Time-to-first-successful-decode** in the live camera harness (wall-clock from
   "code in view" to first correct payload).
3. **Success rate** over a fixed window of frames (robustness, not just speed).
4. Same three for v37 and a mid rung (v17) for the latency curve.

Compare three engines on identical inputs:
- **quirc-mesh (pure JS)** — the candidate.
- **zxing-cpp (WASM)** — the known-good baseline (via `zxing-wasm`; reuse the
  banana_split PoC numbers / harness).
- *(optional)* **quirc-mesh (WASM)** if/when compiled — to isolate the
  language overhead from the algorithm.

## Acceptance thresholds

These are guidance, not hard gates — the live "feel" matters most:

- **Ship pure-JS if:** median per-frame decode for v40 is **well under ~1 s** on
  the reference laptop (so a scanning loop at even 1–2 fps locks on within a
  second or two), success rate comparable to zxing-cpp, and time-to-first-decode
  feels immediate in the camera harness. A few hundred ms/frame is great; up to
  ~1 s is acceptable for one-shot recovery.
- **Consider WASM if:** v40 decode is multiple seconds/frame, or success rate is
  materially worse than zxing-cpp, making the scan frustrating.

Record the actual numbers either way; "it felt fine" plus medians is the artifact.

## Method

- Clean-image latency: loop `decode(imageData)` N times over the corpus PNGs,
  time each, in Node (V8) and in-browser (note both — browser canvas/JIT differs).
- Camera: use `harness/camera.html`; it already needs the per-frame timing for UX,
  so reuse those counters. Log to a downloadable JSON.
- Hold print quality / distance constant (use the **reusable printed sheets**;
  the vectors are byte-identical to them). Note camera, browser, lighting per run.
- Watch out for the **Firefox `resistFingerprinting`** gotcha (banana_split saw it
  in 2022): it farbles `getImageData`, corrupting canvas readback, and historically
  JIT wasn't fully enabled — both can wreck a JS decoder specifically. Test with it
  on and off; document behavior.

## If WASM is chosen — provenance requirements

The whole point of owning the pipeline (see `banana_split` memory: supply-chain
stance) is that a WASM blob must be **reproducible and provenance-stamped**, not
opaque:

- Pin upstream source (this fork's commit + sha256 of the tree).
- Pin the toolchain (`emsdk` version) for a **reproducible** build:
  `SOURCE_DATE_EPOCH`, `-fno-ident`, deterministic input ordering, strip absolute
  paths.
- **Compile provenance into the artifact**: embed sha256 + IPFS CID of the source
  tree and of the resulting `.wasm`, surfaced in-app, so "trust the blob" becomes
  "re-run a reproducible build from content-addressed sources and diff the hash."
- Build **QR-only** (no other symbologies) to minimize size and surface.

If pure-JS wins, none of this is needed — which is the better outcome.
