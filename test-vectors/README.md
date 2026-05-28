# Test vectors

The corpus the decoder must satisfy. **Ground truth** for each image is the exact
decoded payload in `expected/<name>.txt` — a correct decoder must reproduce it
**byte-for-byte** (no trailing newline; the payloads contain none).

`manifest.json` indexes everything: file, sha256, QR version, module count, EC
level, char count, payload prefix, and the matching expected file.

## ⚠️ These are not secrets

Every payload is **random data** (`gen-sample-qr.js` uses `crypto.randomBytes`)
wrapped in a placeholder `BS2 05 3 02 ` header that mimics the Banana Split v2
shard prefix. There is **no real key material** here. Safe to publish with the
open-source fork.

## The vectors

| file | version | modules | EC | chars | role |
|---|---|---|---|---|---|
| `qr_worst_2of3_fullkey_ECL.png` | **40** | 177×177 | L | 4278 | **THE acid test** — printed & camera-verified with zxing-cpp |
| `qr_mid_3of5_fullkey_ECM.png` | **37** | 165×165 | M | 2877 | dense, printed |
| `qr_easy_3of5_seedphrase_ECH.png` | 10 | 57×57 | H | 164 | control — scans on everything |
| `qr_ladder_v07.png` | 7 | 45×45 | M | 177 | clean-image regression rung |
| `qr_ladder_v12.png` | 12 | 65×65 | M | 372 | rung |
| `qr_ladder_v17.png` | 17 | 85×85 | M | 657 | rung |
| `qr_ladder_v21.png` | 21 | 101×101 | M | 987 | rung |
| `qr_ladder_v25.png` | 25 | 117×117 | M | 1392 | rung |
| `qr_ladder_v30.png` | 30 | 137×137 | M | 1857 | rung |
| `qr_ladder_v34.png` | 34 | 153×153 | M | 2412 | rung |

The **ladder** (v7→v34) is for clean-image regression: a decoder should walk up it
and you can see exactly where it breaks. The **named** v37/v40 codes are the dense
real-world targets; the v40 is the one stock quirc/jsQR/zxing-js fail from a
camera and zxing-cpp passes.

## Reuse the printouts for real-world testing

The original author **printed `qr_worst` (v40) and `qr_mid` (v37) at 100% zoom**
and verified zxing-cpp reads them from a Framework 13 1080p webcam (5.6 px/module).
The PNGs here are **byte-identical** (verify via the sha256 in `manifest.json`), so
**those same physical sheets are valid test targets** for quirc-mesh's camera
acid test — no need to reprint. If you do reprint, use 100% scale and a standard
4-module quiet zone (the generator's `margin: 4`).

## Regenerating / extending

- **Re-derive `expected/` + `manifest.json`** from the images (oracle = zxing-cpp):
  ```
  # from a dir with zxing-wasm + pngjs installed (e.g. banana_split/_scratch, or after npm install here)
  node build-manifest.mjs
  ```
- **Regenerate the 3 named PNGs** (random payloads; changes the bytes!):
  ```
  node gen-sample-qr.js     # needs the `qrcode` npm package
  ```
  Note: this produces **new random payloads**, so you'd then re-run
  `build-manifest.mjs` and reprint. For reproducible camera testing, keep the
  committed PNGs as-is.
- **Add a rung**: drop a PNG in `images/`, run `build-manifest.mjs`; it decodes and
  records it automatically (version inferred from a `qr_ladder_vNN.png` name).

## Verifying integrity

```
sha256sum -c <(node -e 'JSON.parse(require("fs").readFileSync("manifest.json")).vectors.forEach(v=>console.log(v.sha256+"  "+v.file))')
```
