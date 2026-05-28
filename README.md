# quirc-mesh

**A tiny, readable QR decoder that reads big QR codes from a webcam — the ones every other pure-JS library quietly gives up on.**

Point a webcam at a small QR code and almost any JavaScript library will read it. Point it at a *big* one — a dense v40 code, 177×177 modules, the kind that holds a few kilobytes — and watch what happens: nothing. No error. No payload. Just silence, frame after frame.

I hit this building a paper-backup tool. The codes themselves were fine; clean PNGs decoded instantly. But held in front of a laptop camera, every pure-JS decoder I tried — [jsQR](https://github.com/cozmo/jsQR), [zxing-js](https://github.com/zxing-js/library), the original [quirc](https://github.com/dlbeer/quirc) — failed silently. The only thing that worked was [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp): excellent, battle-tested, and a ~1 MB opaque WebAssembly blob. For a tool whose whole pitch is "you can audit every line that touches your secret key," shipping a megabyte of compiled C++ felt like cheating.

quirc-mesh is the attempt to get that same capability — big codes, real camera, byte-exact — in a few thousand lines of plain JavaScript you can actually read.

## Why the others fail (and what changed)

Here's the part I didn't understand until I went digging.

A QR decoder has to map each module — the little black-and-white squares — from the camera image back onto a clean grid. The small libraries do this with **one** perspective transform, anchored on the three big finder squares in the corners. For a flat code under a flat lens, one transform is exact.

But a sheet of paper in front of a webcam is *not* flat to the lens. There's a little curl in the paper, a little barrel distortion from a cheap wide lens, a little tilt. Across a small code that error is invisible. Across 177 modules it piles up past half a module — and once your grid is half a module off, every bit downstream is wrong, Reed–Solomon gives up, and you get... silence.

The QR spec actually plans for this. A v40 code carries ~46 *alignment patterns* sprinkled across its face for exactly one reason: so a decoder can stop pretending the code is flat and sample it **piecewise**. zxing-cpp does this. The small JS libraries don't.

quirc-mesh forks quirc — Daniel Beer's wonderfully compact C decoder — and swaps its single global transform for a **mesh**: it finds every alignment pattern it can, builds a grid of small local transforms between them, and samples each module through its *nearest* patch instead of through one transform for the whole code. That's the entire idea. The rest is careful porting.

## Quick start

It's pure ESM, has no runtime dependencies, and runs in browsers and Node ≥ 18.

```bash
npm install quirc-mesh
```

```js
import { decode } from "quirc-mesh";

// imageData is { data: Uint8ClampedArray, width, height } —
// straight from canvas.getContext("2d").getImageData(...) in a browser,
// or pngjs in Node.
const result = decode(imageData, { adaptive: true });

if (result) {
  console.log(result.text);                           // the payload
  console.log("v" + result.version, result.ecLevel);  // e.g. "v40 L"
} else {
  // No decode. Not a wrong decode — see "The promise" below.
}
```

Two options are worth knowing:

- **`adaptive: true`** — local binarization for uneven webcam lighting. Turn it on for camera frames; leave it off (the default) for clean scans, where a single global threshold is already exact.
- **`mesh: true`** (the default) — the piecewise sampling described above. Set it to `false` and you get the classic single-transform behavior. Handy for an A/B comparison; it will fail the hard cases on purpose.

There's also `decodeAll` (every code in a frame) and `decodeDebug` (adds detection diagnostics). A live webcam demo lives in `harness/camera.html` — clone the repo and run `npm run serve`.

## When you should (and shouldn't) reach for this

I'd rather point you at the right tool, even when it isn't this one.

**Use quirc-mesh when** you need to read *large* QR codes (roughly v20 and up) from a *camera*, and you care about reading the decoder with your own eyes — no WASM, no build step, no dependencies.

**Don't bother when** your codes are small and your input is a clean image. jsQR is smaller and completely fine for that; you won't notice the difference. And if you decode from cameras at scale and don't need auditability, zxing-cpp is, and will remain, far more mature than this. quirc-mesh is deliberately narrow: it's the decoder you pick when the small ones fail you *and* a megabyte of WASM isn't an option.

Also: it **decodes**, it doesn't generate. Plenty of good libraries make QR codes; this one only reads them.

## The promise: wrong is worse than nothing

This started life inside a backup tool, and that left a mark on the design.

If you're recovering a secret key from a sheet of paper, a decoder that confidently returns the *wrong* bytes is a catastrophe — much worse than one that says "I couldn't read it, hold still and try again." So quirc-mesh is **fail-closed**: every result is gated on Reed–Solomon and the format/version checksums actually verifying. If they don't, you get `null`. Never a plausible-looking lie.

I lean on this hard. Across 900 fuzzing trials — corrupted bits, added noise, random crops — it produced **zero** wrong reads. Null or correct, nothing in between. That's the one invariant I'd ask you to trust.

## Does it actually work?

The honest test wasn't a benchmark. It was printing the worst code I had at 100% zoom — about two-thirds of an A4 sheet — and holding it up to a Framework 13's built-in 1080p webcam.

That code is a **v40, EC-level-L, 177×177-module** monster: a full 4096-bit key packed into a single shard. quirc-mesh reads it byte-exact, in **both Chrome and Firefox**, at 3.4–5.0 pixels per module — right at the edge of what the sensor can resolve. That's precisely the case stock quirc, jsQR, and zxing-js all fail.

A few numbers for calibration:

- Clean v7–v40 images: **10/10** byte-exact.
- A v40 frame decodes in **~49 ms (p90)** in pure JS — fast enough that WebAssembly bought nothing, so there is none.
- **~1.9k lines** of decoder. Zero runtime dependencies.

It's early (`0.2.0`). `0.2` reworked the detection front-end for large/close-up codes: grouping no longer relies on extrapolating a finder's local frame across the whole symbol, so a near-full-frame v40 now decodes (it previously found the finders but couldn't group them), and a few unbounded geometric searches that could make a cluttered frame hang for seconds are now bounded. The remaining rough edge is *sampling* under heavy lens distortion — detection finds the code, but the mesh can't always recover every module yet.

## How it actually works

The code is meant to be read — that was the whole point. If you want the real thing:

- **`docs/ALGORITHM.md`** — the mesh sampling design, in detail.
- **`docs/PRIOR_ART.md`** — why the small libraries fail and why zxing-cpp wins, with links and the exact upstream code that's the culprit.
- **`docs/NOTES.md`** — a running log of every assumption and design decision made while building this, so any choice can be traced back and argued with later.

The pipeline, end to end: binarize → find the finder patterns → group them into a code → read format and version → locate the alignment patterns → build the mesh → sample the module matrix → undo the mask → Reed–Solomon → decode the segments. quirc owns most of those steps; the alignment / mesh / sampling middle is the new part.

## Credits

quirc-mesh is a derivative work of **[quirc](https://github.com/dlbeer/quirc)** by **Daniel Beer**, whose detection and decoding pipeline it ports almost verbatim. quirc is a genuinely lovely piece of C — small enough to read in an afternoon — and none of this would exist without it. Its copyright notice is preserved in `LICENSE` and under `reference/quirc/`.

The thing it was built for is **[Banana Split](https://github.com/paritytech/banana_split)**, a Shamir-secret-sharing paper-backup tool that needs to scan dense shards on its recovery path without bundling a binary blob.

## License

[ISC](./LICENSE), same as quirc. Use it for anything.
