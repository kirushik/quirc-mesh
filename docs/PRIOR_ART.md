# Prior art & root cause

This is the "why" behind quirc-mesh. Read it before touching code.

## 1. The observed failure

Banana Split v2 needs to scan QR shards that, for large secrets, reach **v37–v40**. Empirically (banana_split, 2026-05-28, Framework 13 laptop + Anker C200 webcam):

| decoder | clean PNG of v40 | **v40 from camera** |
|---|---|---|
| `jsQR` | reads | **fails** |
| `zxing-js` (`@zxing/browser`) | reads | **fails** |
| stock `quirc` | reads small/mid; flaky high | **fails (architectural — see §3)** |
| **`zxing-cpp`** (WASM, via `zxing-wasm`) | reads | **reads** ✅ (5.6 px/module, both Chrome & Firefox) |
| phone native `BarcodeDetector` | reads | reads (not available on Linux desktop) |

A v10 control code (57×57) scans on everything. The failure is specific to **high version + camera**.

The community has hit this for years: "high-version QR codes (v20+) fail silently in ZXing and ZBar" is a recurring report; `jsQR` and `zxing-js` are both effectively **unmaintained**.

## 2. Why version matters: the alignment-pattern mesh

A QR code of version *V* is `(4V+17)×(4V+17)` modules. It has:
- **3 finder patterns** (the big corner squares) — used to locate the code and establish a coarse perspective.
- **Alignment patterns** — small concentric squares placed on a grid, *added precisely so decoders can correct distortion locally*. Their count grows with version:
  - v1: 0 · v2–6: 1 · v7: 6 · … · **v40: 46** (a 7×7 grid of candidate positions minus the 3 corners occupied by finders).

The alignment grid coordinates per version are in the spec (ISO/IEC 18004) and are already tabulated in quirc's `version_db.c` (`apat[]`, up to `QUIRC_MAX_ALIGNMENT = 7` coordinate values per axis).

**Key insight:** the spec puts ~46 alignment patterns in a v40 code *because one perspective transform is not enough*. A camera image of a printed code has lens distortion + paper curl + non-fronto-parallel pose. A single homography fit to the 3 finders (+ maybe 1 alignment pattern) is accurate near those anchors and drifts elsewhere. Over 177 modules the drift exceeds half a module → cells sampled from the wrong pixel → bit errors beyond what Reed–Solomon can fix → silent failure. Correcting this requires sampling **each region of the code through a transform fit to the *local* alignment patterns**.

## 3. Root cause in quirc (and the same shape in jsQR/zxing-js)

Confirmed in the pinned source at `../reference/quirc/` (commit `927d680`):

- **`identify.c:850 setup_qr_perspective()`** builds **one** transform `qr->c` from exactly 4 points: the 3 capstone (finder) corners + **one** alignment point `qr->align`:
  ```c
  memcpy(&rect[0], &q->capstones[qr->caps[1]].corners[0], …);
  memcpy(&rect[1], &q->capstones[qr->caps[2]].corners[0], …);
  memcpy(&rect[2], &qr->align, …);                 // ← a SINGLE alignment pattern
  memcpy(&rect[3], &q->capstones[qr->caps[0]].corners[0], …);
  perspective_setup(qr->c, rect, qr->grid_size - 7, qr->grid_size - 7);
  jiggle_perspective(q, index);                     // nudges those 4 points only
  ```
- **`identify.c:690 read_cell()`** samples **every** module through that single `qr->c`:
  ```c
  perspective_map(qr->c, x + 0.5, y + 0.5, &p);     // one global transform for all cells
  return q->pixels[p.y * q->w + p.x] ? 1 : -1;
  ```
- **`identify.c:578 find_alignment_pattern()`** locates only **one** alignment pattern (near the expected bottom-right position).
- The full `apat[]` coordinates are used only by the **fitness** function (`identify.c:763` region) to *score* the global perspective for `jiggle_perspective` — **never** to re-sample the grid piecewise.

So quirc, like jsQR and zxing-js, is fundamentally a **single-homography** decoder. Its small size is exactly because it skips the expensive per-region CV. That's the gap quirc-mesh fills.

> `jsQR` (`cozmo/jsQR`) and `zxing-js` (`@zxing/library`) have the same structure: locate finders, optionally one alignment pattern, compute a single `PerspectiveTransform`, sample the whole grid. Hence the same failure mode.

## 4. Why zxing-cpp succeeds

`zxing-cpp` (maintained successor to the C++ ZXing, github.com/zxing-cpp/zxing-cpp) has a substantially rewritten detector that, for higher versions, **locates the alignment-pattern grid and samples the bit matrix piecewise** rather than through one global transform. That's the capability we replicate. (We don't need to copy its code — it's Apache-2.0 and large; we want the *algorithm* in a quirc-sized package. See `ALGORITHM.md`.)

It is proven on our hardware: the printed `qr_worst_2of3_fullkey_ECL.png` (v40) reads from the Framework 13 1080p webcam in both browsers. The only objection to shipping it in Banana Split is the ~1 MB opaque WASM blob — which is the entire motivation for quirc-mesh.

## 5. The Banana Split context (capacity numbers)

From the v2 capacity benchmark (`banana_split/_scratch/RESULTS.md`, `V2_DESIGN.md` §8):

- A real full GPG keypair (RSA-4096 primary + 4096 subkey) armored = 7402 B; deflated = **5589 B**.
- Pipeline = encrypt → erasure-code into `k` fragments (≈|C|/k each) → base45 → QR. For the deflated full keypair:
  - **2-of-3** → fragment 2844 B → 4278 base45 chars → **v40 EC-L** (the absolute max QR; this is `qr_worst`).
  - **3-of-5** → 1910 B → 2877 chars → **v37 EC-M** (`qr_mid`).
  - **4-of-7** → 1443 B → 2177 chars → v38 EC-Q.
- A *single* 4096 key deflates to ≈ paperkey size (2593 B) and needs only ~4-of-7…5-of-9 at the more scannable v≤20 sizes.
- Human-scale secrets (seed phrases, passwords) are trivially 2-of-3 at any EC (`qr_easy`, v10).

So the dense-code problem only bites for *large* secrets, but Banana Split wants to support them with **one QR per shard** (lowest human/mental complexity — no multi-QR-per-shard juggling). That requires a decoder that can read v40 from a camera. Hence this project.

The deeper design rationale (one-QR-per-shard, base45, DEFLATE, the WASM-provenance trade-off, why pure-JS is preferred) lives in `banana_split/V2_DESIGN.md` §8.2–§8.3 and `SECURITY_REVIEW.md`.

## 6. References

Verify links before relying on them; some are starting points.

- **quirc** (the fork base, ISC): https://github.com/dlbeer/quirc — pinned source vendored at `../reference/quirc/`.
  - Field reports of detection failures: issues #22, #50.
  - An old Emscripten port for inspiration: https://github.com/zz85/quirc.js
- **zxing-cpp** (the engine that works; algorithm reference): https://github.com/zxing-cpp/zxing-cpp
- **jsQR** (single-homography, fails): https://github.com/cozmo/jsQR
- **zxing-js** (single-homography, fails): https://github.com/zxing-js/library
- **QR spec**: ISO/IEC 18004. Practical tutorials: https://www.thonky.com/qr-code-tutorial/ (alignment-pattern position table, format/version info, masking, RS), https://en.wikipedia.org/wiki/QR_code
- **Banana Split**: https://github.com/paritytech/banana_split — esp. issue #32 (capacity discussion with Jeff Burdges) and the local `V2_DESIGN.md`.
- **Reed–Solomon / GF(256)**: quirc's `decode.c` already implements the QR RS decoder; reuse it.
