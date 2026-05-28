# The mesh grid-sampling algorithm

This is the core of quirc-mesh: replace quirc's single global homography with
**piecewise sampling over the mesh of alignment patterns**. Everything else
(finder detection, version/format read, demasking, Reed–Solomon, data decode)
is reused from quirc with minimal change.

## 0. Pipeline overview

```
camera frame (RGBA/gray)
  → 1. binarize (adaptive threshold)              [reuse quirc threshold.c logic]
  → 2. find finder patterns ("capstones")         [reuse quirc identify.c]
  → 3. group 3 finders into a code; estimate version (grid size)   [reuse]
  → 4. read format info (EC level + mask)          [reuse decode.c]
  ──────────────── NEW ────────────────
  → 5. locate ALL alignment patterns (expected grid from version_db, refined)
  → 6. build a sampling MESH from {finder corners ∪ found alignment centers}
  → 7. for each module (x,y): map via the LOCAL mesh cell, sample pixel
  ──────────────────────────────────────
  → 8. de-mask the bit matrix                       [reuse decode.c]
  → 9. Reed–Solomon decode → data codewords         [reuse decode.c]
  → 10. decode segments (alphanumeric/byte/…) → text/bytes   [reuse decode.c]
```

Steps 1–4 and 8–10 already exist in quirc and work even for high versions —
quirc's *only* fatal weakness is step 7 using a single transform. Steps 5–7 are
the work.

## 1. What we keep from quirc

- **Binarization** and connected-component region labeling.
- **Finder (capstone) detection** and grouping into a candidate code (`identify.c`).
- **Grid-size / version estimation** from finder spacing (`measure_grid_size`).
- **Format-info decode** (mask pattern + EC level), **demask**, **block
  deinterleave**, **Reed–Solomon** error correction, and **segment decoding**
  (numeric/alphanumeric/byte) in `decode.c`. quirc's RS over GF(256) is correct;
  do not rewrite it.

Keep quirc's data structures (`quirc_grid`, `quirc_code`, `quirc_data`) and its
`version_db` (it already has every alignment-pattern coordinate we need).

## 2. The change, conceptually

quirc samples module (x,y) as `perspective_map(qr->c, x+0.5, y+0.5)` using one
transform `qr->c`. We instead:

1. Know, from `version_db.apat[]`, the **module coordinates** of every alignment
   pattern for this version (their centers), plus the three finder centers
   (at fixed module coords `(3,3)`, `(W-4,3)`, `(3,W-4)` where `W=4V+17`), and
   the implicit fourth corner.
2. **Find each alignment pattern's pixel center** in the image (refine an initial
   guess obtained from the coarse global transform).
3. Treat `{module-coord → pixel-coord}` for all found control points as a
   **mesh of correspondences**. For any module (x,y), find the local
   quadrilateral of control points that encloses it and map through a transform
   fit to *that* quad (or bilinear-interpolate within it). This tracks local
   distortion the global homography misses.

This is exactly why the spec scatters alignment patterns across the symbol.

## 3. Step 5 — locate all alignment patterns

```
W = 4*V + 17
coords = version_db[V].apat      // e.g. v40: {6,30,58,86,114,142,170}
global = coarse homography from 3 finders (+ maybe the one quirc already finds)

control = []   // list of {mx, my, px, py}  (module coords + pixel coords)

// finder centers are exact, high-confidence control points:
add control (3,        3,        finderTL.center)
add control (W-4,      3,        finderTR.center)
add control (3,        W-4,      finderBL.center)

for ay in coords:
  for ax in coords:
    if (ax,ay) lies under a finder (the three corner positions): skip
    // expected pixel from coarse transform:
    (ex, ey) = global.map(ax+0.5, ay+0.5)
    // search a small window around (ex,ey) for the alignment pattern:
    found = locate_alignment_pattern(image, ex, ey, expectedModulePx)
    if found:
      add control (ax, ay, found.cx, found.cy)
    // if not found, leave it out — the mesh interpolates from neighbors
```

`locate_alignment_pattern`: an alignment pattern is a 5×5 module concentric
square (dark/light/dark). quirc's `find_alignment_pattern` already does this for
one pattern by scanning a region for the right ring profile; **generalize it** to
run at each expected location with a search window of ± a few modules (distortion
is local, so the guess is close). Reuse quirc's region/ring detection.

Robustness:
- A pattern that isn't found (occlusion, glare, damage) is simply omitted; the
  mesh still works as long as neighbors exist. Require a minimum coverage (e.g.
  finders + ≥ ~50% of alignment patterns) before trusting the sample.
- Reject outliers: a found center whose pixel position deviates wildly from the
  bilinear prediction of its neighbors is likely a false match — drop it.

## 4. Step 6 — build the sampling mesh

You have control points on an irregular but topologically-grid layout (module
coords come from `coords` ∪ finder positions). Two viable constructions:

**Option A — per-cell bilinear (recommended; simplest, matches zxing-cpp's spirit).**
Form a grid whose rows/cols are the alignment-pattern coordinate lines (plus the
finder rows/cols at the edges). Each grid cell is a quad with 4 known corners
(module→pixel). To sample module (x,y): find the cell `[cx0,cx1]×[cy0,cy1]` of
*coordinate lines* containing (x,y), then bilinearly interpolate the pixel
position from the 4 corner correspondences. Missing corners: substitute from a
neighboring cell's shared edge, or fall back to the global homography for that
cell only.

**Option B — local homography per cell.** Fit a 4-point projective transform per
quad. Slightly more accurate at strong perspective, more code. Start with A.

Edge handling: the outermost rows/cols of modules (timing patterns, near
finders) are covered by the finder control points; extrapolate using the nearest
cell's transform.

## 5. Step 7 — sample each module

```
for y in 0..W-1:
  for x in 0..W-1:
    (px,py) = mesh.map(x + 0.5, y + 0.5)
    matrix[y][x] = image_is_dark(px, py)   // nearest pixel or small-window vote
```

Use a tiny voting window (quirc's `fitness_cell` samples a 3×3 of offsets — do
similar) for noise immunity. Then hand `matrix` to quirc's existing demask + RS
+ decode (steps 8–10).

## 6. Correctness & fail-closed (critical — see PRD AC-4)

For a backup tool, a **silently wrong** decode is the worst outcome. Defenses,
all already inherent to QR + quirc, must be preserved:

- **Reed–Solomon** rejects matrices with more errors than EC allows — it does not
  "guess". If sampling is bad, RS fails → we return *no result*, never wrong bytes.
- **Format-info** has its own BCH error correction; a bad format read aborts early.
- Banana Split's v2 payload has its **own integrity** (authenticated cipher / CRC
  in the wire format) — a second backstop above the QR layer.
- Never return a result from a partial/low-coverage sample without RS success.

Add negative tests: random-noise images, cropped codes, wrong-version guesses —
assert the decoder returns failure, not a payload.

## 7. Porting note (C vs JS)

- The **algorithm is language-agnostic.** Decide implementation language per
  `BENCHMARK_PLAN.md`. The recommendation is to **prototype directly in JS**
  (fast iteration, and JS is the target for Banana Split), using quirc's C as the
  reference for the reused steps.
- If WASM is needed (perf), implement the *same* steps 5–7 in the C fork and
  compile via Emscripten. Steps 1–4, 8–10 are already quirc C.
- Keep a single source of truth for the algorithm; don't let a C and a JS version
  drift. Either JS-only, or C-as-canonical-compiled-to-WASM — not both hand-maintained.

## 8. Suggested module layout (JS-first)

```
src/
  binarize.js        // adaptive threshold → bit image (port quirc threshold)
  finder.js          // capstone detection + grouping + version estimate (port identify.c)
  perspective.js     // homography setup/map/unmap (port quirc perspective_*)
  alignment.js       // NEW: locate all alignment patterns (generalize find_alignment_pattern)
  mesh.js            // NEW: build mesh + map(module)->pixel (Option A bilinear)
  sample.js          // NEW: matrix extraction via mesh
  format.js          // format/version info decode (port decode.c bits)
  rs.js              // GF(256) Reed–Solomon (port decode.c)
  decode.js          // demask, deinterleave, segment decode (port decode.c)
  index.js           // public API: decode(imageData) -> result
```

`version_db.js` — port quirc's `version_db.c` table verbatim (alignment coords,
EC block structure). It's data; transcribe carefully and add a test that checks a
few known versions against the spec.
