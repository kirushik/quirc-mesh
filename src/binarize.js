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
