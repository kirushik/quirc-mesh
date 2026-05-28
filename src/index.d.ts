// Type declarations for the quirc-mesh public API.

export interface ImageLike {
  /** RGBA (4 bytes/px), RGB (3), or grayscale (1) pixel data. */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface DecodeOptions {
  /** Piecewise alignment-pattern mesh sampling (default true). false = single homography. */
  mesh?: boolean;
  /** Local adaptive binarization for camera lighting (default false = global Otsu). */
  adaptive?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface DecodeResult {
  /** Decoded text (UTF-8 interpretation of the payload bytes). */
  text: string;
  /** Raw decoded payload bytes. */
  bytes: Uint8Array;
  /** QR version 1..40. */
  version: number;
  /** Error-correction level: "L" | "M" | "Q" | "H". */
  ecLevel: string;
  /** Data mask pattern 0..7. */
  mask: number;
  /** Highest data-type encountered (1 numeric, 2 alpha, 4 byte, 8 kanji). */
  dataType: number;
  /** ECI assignment number (0 if none). */
  eci: number;
  /** The four detected code corners in image pixels, clockwise from top-left. */
  corners: Point[];
}

export interface DecodeDebug {
  result: DecodeResult | null;
  /** Number of finder ("capstone") patterns detected. */
  capstones: number;
  /** Candidate grids found, with their estimated version + module size. */
  grids: Array<{ version: number; gridSize: number }>;
}

/** Decode the first readable QR code in the image. Returns null on failure (fail-closed). */
export function decode(image: ImageLike, opts?: DecodeOptions): DecodeResult | null;

/** Decode all readable QR codes in the image (possibly empty). */
export function decodeAll(image: ImageLike, opts?: DecodeOptions): DecodeResult[];

/** Like decode(), but also returns detection diagnostics (for tooling/debugging). */
export function decodeDebug(image: ImageLike, opts?: DecodeOptions): DecodeDebug;

declare const _default: {
  decode: typeof decode;
  decodeAll: typeof decodeAll;
  decodeDebug: typeof decodeDebug;
};
export default _default;
