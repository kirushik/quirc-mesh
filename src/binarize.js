// Grayscale conversion + binarization.
//
// M1: global Otsu threshold (port of quirc identify.c otsu + pixels_setup).
// M3 will add a block-based local adaptive binarizer for the camera path.

export const PIXEL_WHITE = 0;
export const PIXEL_BLACK = 1;
export const PIXEL_REGION = 2;

// Convert an ImageData-shaped object {data, width, height} to a single-channel
// 8-bit grayscale Uint8Array (length width*height). Accepts RGBA (4 bytes/px),
// RGB (3), or already-grayscale (1) input.
export function toGray(image) {
  const { data, width, height } = image;
  const n = width * height;
  const out = new Uint8Array(n);
  const channels = data.length / n;

  if (channels === 1) {
    out.set(data.subarray ? data.subarray(0, n) : data.slice(0, n));
    return out;
  }
  const step = channels | 0;
  for (let i = 0, p = 0; i < n; i++, p += step) {
    // Integer luma approximation: (77*R + 150*G + 29*B) >> 8.
    out[i] = (77 * data[p] + 150 * data[p + 1] + 29 * data[p + 2]) >> 8;
  }
  return out;
}

// Otsu's method: the global threshold maximizing between-class variance.
// Faithful port of quirc's otsu() (ties resolved toward the higher level via >=).
export function otsu(gray) {
  const numPixels = gray.length;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < numPixels; i++) histogram[gray[i]]++;

  let sum = 0;
  for (let i = 0; i <= 255; i++) sum += i * histogram[i];

  let sumB = 0;
  let q1 = 0;
  let max = 0;
  let threshold = 0;
  for (let i = 0; i <= 255; i++) {
    q1 += histogram[i];
    if (q1 === 0) continue;
    const q2 = numPixels - q1;
    if (q2 === 0) break;
    sumB += i * histogram[i];
    const m1 = sumB / q1;
    const m2 = (sum - sumB) / q2;
    const m1m2 = m1 - m2;
    const variance = m1m2 * m1m2 * q1 * q2;
    if (variance >= max) {
      threshold = i;
      max = variance;
    }
  }
  return threshold;
}

// Produce the pixel/label buffer: dark (value < threshold) => BLACK(1), else WHITE(0).
// Region labeling later overwrites BLACK runs with region codes (>= PIXEL_REGION).
//
// Uint16 (not Uint8): the buffer doubles as the connected-component label map, and
// dense high-version codes (v30-v40) produce far more than 254 black regions. A
// byte label map (like stock quirc's default) exhausts its region cap before the
// third finder is even labeled, so v40 detection fails outright. Quirc's own
// internal header has this exact uint16 branch for QUIRC_MAX_REGIONS >= 254.
export function binarizeGlobal(gray, threshold) {
  const pixels = new Uint16Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    pixels[i] = gray[i] < threshold ? PIXEL_BLACK : PIXEL_WHITE;
  }
  return pixels;
}

// Local adaptive binarization (block-based, after ZXing's HybridBinarizer
// algorithm). Handles uneven lighting / shadows / gradients that a single global
// threshold cannot — the camera path. Estimates a black point per 8x8 block from a
// 5x5 neighbourhood of block averages; low-contrast blocks defer to neighbours so
// uniform regions don't speckle.
const BLOCK = 8;
const MIN_DYNAMIC_RANGE = 24;

export function binarizeAdaptive(gray, w, h) {
  if (w < BLOCK || h < BLOCK) return binarizeGlobal(gray, otsu(gray));

  let subW = w >> 3; if (w & 7) subW++;
  let subH = h >> 3; if (h & 7) subH++;
  const blackPoints = new Int32Array(subW * subH);

  for (let by = 0; by < subH; by++) {
    let yoffset = by << 3;
    if (yoffset > h - BLOCK) yoffset = h - BLOCK;
    for (let bx = 0; bx < subW; bx++) {
      let xoffset = bx << 3;
      if (xoffset > w - BLOCK) xoffset = w - BLOCK;

      let sum = 0, min = 255, max = 0;
      for (let yy = 0; yy < BLOCK; yy++) {
        const row = (yoffset + yy) * w + xoffset;
        for (let xx = 0; xx < BLOCK; xx++) {
          const px = gray[row + xx];
          sum += px;
          if (px < min) min = px;
          if (px > max) max = px;
        }
      }

      let avg;
      if (max - min > MIN_DYNAMIC_RANGE) {
        avg = sum >> 6; // sum / 64
      } else {
        avg = min >> 1;
        if (by > 0 && bx > 0) {
          const bp = blackPoints;
          const neighbour = (bp[(by - 1) * subW + bx] + 2 * bp[by * subW + bx - 1] +
                             bp[(by - 1) * subW + bx - 1]) / 4;
          if (min < neighbour) avg = neighbour;
        }
      }
      blackPoints[by * subW + bx] = avg;
    }
  }

  const pixels = new Uint16Array(w * h);
  for (let by = 0; by < subH; by++) {
    let yoffset = by << 3;
    if (yoffset > h - BLOCK) yoffset = h - BLOCK;
    const top = clamp(by, 2, subH - 3);
    for (let bx = 0; bx < subW; bx++) {
      let xoffset = bx << 3;
      if (xoffset > w - BLOCK) xoffset = w - BLOCK;
      const left = clamp(bx, 2, subW - 3);

      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const r = (top + dy) * subW + left;
        for (let dx = -2; dx <= 2; dx++) sum += blackPoints[r + dx];
      }
      const avg = sum / 25;

      for (let yy = 0; yy < BLOCK; yy++) {
        const row = (yoffset + yy) * w + xoffset;
        for (let xx = 0; xx < BLOCK; xx++) {
          pixels[row + xx] = gray[row + xx] <= avg ? PIXEL_BLACK : PIXEL_WHITE;
        }
      }
    }
  }
  return pixels;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
