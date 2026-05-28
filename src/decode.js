// Bit-matrix -> payload decoder. Port of quirc decode.c (everything below RS):
// read_format, demask, reserved-cell map, zig-zag bit read, block deinterleave,
// and segment decoding (numeric / alphanumeric / byte / kanji / ECI).

import { VERSION_DB, eccParams, gridSize as gridSizeOf } from "./version_db.js";
import { correctBlock, correctFormat } from "./rs.js";
import { gridBit } from "./sample.js";
import { ERR } from "./errors.js";

const MAX_PAYLOAD = 8896;
const MAX_GRID_SIZE = 177;

const DATA_TYPE = { NUMERIC: 1, ALPHA: 2, BYTE: 4, KANJI: 8 };
const ALPHA_MAP = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function readFormat(code, data, which) {
  let format = 0;

  if (which) {
    for (let i = 0; i < 7; i++) format = (format << 1) | gridBit(code, 8, code.size - 1 - i);
    for (let i = 0; i < 8; i++) format = (format << 1) | gridBit(code, code.size - 8 + i, 8);
  } else {
    const xs = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
    const ys = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8];
    for (let i = 14; i >= 0; i--) format = (format << 1) | gridBit(code, xs[i], ys[i]);
  }

  format ^= 0x5412;

  const { err, value } = correctFormat(format);
  if (err) return err;

  const fdata = value >> 10;
  data.eccLevel = fdata >> 3;
  data.mask = fdata & 7;
  return ERR.SUCCESS;
}

function maskBit(mask, i, j) {
  switch (mask) {
    case 0: return ((i + j) % 2) === 0 ? 1 : 0;
    case 1: return (i % 2) === 0 ? 1 : 0;
    case 2: return (j % 3) === 0 ? 1 : 0;
    case 3: return ((i + j) % 3) === 0 ? 1 : 0;
    case 4: return ((Math.trunc(i / 2) + Math.trunc(j / 3)) % 2) === 0 ? 1 : 0;
    case 5: return (((i * j) % 2) + ((i * j) % 3)) === 0 ? 1 : 0;
    case 6: return ((((i * j) % 2) + ((i * j) % 3)) % 2) === 0 ? 1 : 0;
    case 7: return ((((i * j) % 3) + ((i + j) % 2)) % 2) === 0 ? 1 : 0;
  }
  return 0;
}

function reservedCell(version, i, j) {
  const ver = VERSION_DB[version];
  const size = version * 4 + 17;

  if (i < 9 && j < 9) return 1;            // finder + format: top-left
  if (i + 8 >= size && j < 9) return 1;    // bottom-left
  if (i < 9 && j + 8 >= size) return 1;    // top-right
  if (i === 6 || j === 6) return 1;        // timing patterns

  if (version >= 7) {                       // version info blocks
    if (i < 6 && j + 11 >= size) return 1;
    if (i + 11 >= size && j < 6) return 1;
  }

  // Alignment patterns.
  const apat = ver.apat;
  let ai = -1, aj = -1, a = 0;
  for (a = 0; a < apat.length; a++) {
    const p = apat[a];
    if (Math.abs(p - i) < 3) ai = a;
    if (Math.abs(p - j) < 3) aj = a;
  }
  if (ai >= 0 && aj >= 0) {
    a--;
    if (ai > 0 && ai < a) return 1;
    if (aj > 0 && aj < a) return 1;
    if (aj === a && ai === a) return 1;
  }
  return 0;
}

function readBit(code, data, ds, i, j) {
  const bitpos = ds.dataBits & 7;
  const bytepos = ds.dataBits >> 3;
  let v = gridBit(code, j, i);
  if (maskBit(data.mask, i, j)) v ^= 1;
  if (v) ds.raw[bytepos] |= (0x80 >> bitpos);
  ds.dataBits++;
}

function readData(code, data, ds) {
  let y = code.size - 1;
  let x = code.size - 1;
  let dir = -1;

  while (x > 0) {
    if (x === 6) x--;
    if (!reservedCell(data.version, y, x)) readBit(code, data, ds, y, x);
    if (!reservedCell(data.version, y, x - 1)) readBit(code, data, ds, y, x - 1);

    y += dir;
    if (y < 0 || y >= code.size) {
      dir = -dir;
      x -= 2;
      y += dir;
    }
  }
}

function codestreamEcc(data, ds) {
  const ver = VERSION_DB[data.version];
  const sbEcc = eccParams(data.version, data.eccLevel);
  const lbCount = Math.trunc((ver.dataBytes - sbEcc.bs * sbEcc.ns) / (sbEcc.bs + 1));
  const bc = lbCount + sbEcc.ns;
  const eccOffset = sbEcc.dw * bc + lbCount;
  let dstOffset = 0;

  const lbEcc = { bs: sbEcc.bs + 1, dw: sbEcc.dw + 1 };

  for (let i = 0; i < bc; i++) {
    const ecc = (i < sbEcc.ns) ? sbEcc : lbEcc;
    const numEc = ecc.bs - ecc.dw;
    const dst = ds.data.subarray(dstOffset, dstOffset + ecc.bs);

    for (let j = 0; j < ecc.dw; j++) dst[j] = ds.raw[j * bc + i];
    for (let j = 0; j < numEc; j++) dst[ecc.dw + j] = ds.raw[eccOffset + j * bc + i];

    const err = correctBlock(dst, ecc);
    if (err) return err;

    dstOffset += ecc.dw;
  }

  ds.dataBits = dstOffset * 8;
  return ERR.SUCCESS;
}

function bitsRemaining(ds) {
  return ds.dataBits - ds.ptr;
}

function takeBits(ds, len) {
  let ret = 0;
  while (len && ds.ptr < ds.dataBits) {
    const b = ds.data[ds.ptr >> 3];
    const bitpos = ds.ptr & 7;
    ret <<= 1;
    if ((b << bitpos) & 0x80) ret |= 1;
    ds.ptr++;
    len--;
  }
  return ret;
}

function numericTuple(data, ds, bits, digits) {
  if (bitsRemaining(ds) < bits) return -1;
  let tuple = takeBits(ds, bits);
  for (let i = digits - 1; i >= 0; i--) {
    data.payload[data.payloadLen + i] = (tuple % 10) + 0x30;
    tuple = Math.trunc(tuple / 10);
  }
  data.payloadLen += digits;
  return 0;
}

function decodeNumeric(data, ds) {
  let bits = 14;
  if (data.version < 10) bits = 10;
  else if (data.version < 27) bits = 12;

  let count = takeBits(ds, bits);
  if (data.payloadLen + count + 1 > MAX_PAYLOAD) return ERR.DATA_OVERFLOW;

  while (count >= 3) {
    if (numericTuple(data, ds, 10, 3) < 0) return ERR.DATA_UNDERFLOW;
    count -= 3;
  }
  if (count >= 2) {
    if (numericTuple(data, ds, 7, 2) < 0) return ERR.DATA_UNDERFLOW;
    count -= 2;
  }
  if (count) {
    if (numericTuple(data, ds, 4, 1) < 0) return ERR.DATA_UNDERFLOW;
    count--;
  }
  return ERR.SUCCESS;
}

function alphaTuple(data, ds, bits, digits) {
  if (bitsRemaining(ds) < bits) return -1;
  let tuple = takeBits(ds, bits);
  for (let i = 0; i < digits; i++) {
    data.payload[data.payloadLen + digits - i - 1] = ALPHA_MAP.charCodeAt(tuple % 45);
    tuple = Math.trunc(tuple / 45);
  }
  data.payloadLen += digits;
  return 0;
}

function decodeAlpha(data, ds) {
  let bits = 13;
  if (data.version < 10) bits = 9;
  else if (data.version < 27) bits = 11;

  let count = takeBits(ds, bits);
  if (data.payloadLen + count + 1 > MAX_PAYLOAD) return ERR.DATA_OVERFLOW;

  while (count >= 2) {
    if (alphaTuple(data, ds, 11, 2) < 0) return ERR.DATA_UNDERFLOW;
    count -= 2;
  }
  if (count) {
    if (alphaTuple(data, ds, 6, 1) < 0) return ERR.DATA_UNDERFLOW;
    count--;
  }
  return ERR.SUCCESS;
}

function decodeByte(data, ds) {
  let bits = 16;
  if (data.version < 10) bits = 8;

  const count = takeBits(ds, bits);
  if (data.payloadLen + count + 1 > MAX_PAYLOAD) return ERR.DATA_OVERFLOW;
  if (bitsRemaining(ds) < count * 8) return ERR.DATA_UNDERFLOW;

  for (let i = 0; i < count; i++) data.payload[data.payloadLen++] = takeBits(ds, 8);
  return ERR.SUCCESS;
}

function decodeKanji(data, ds) {
  let bits = 12;
  if (data.version < 10) bits = 8;
  else if (data.version < 27) bits = 10;

  const count = takeBits(ds, bits);
  if (data.payloadLen + count * 2 + 1 > MAX_PAYLOAD) return ERR.DATA_OVERFLOW;
  if (bitsRemaining(ds) < count * 13) return ERR.DATA_UNDERFLOW;

  for (let i = 0; i < count; i++) {
    const d = takeBits(ds, 13);
    const msB = Math.trunc(d / 0xc0);
    const lsB = d % 0xc0;
    const intermediate = (msB << 8) | lsB;
    let sjw;
    if (intermediate + 0x8140 <= 0x9ffc) sjw = intermediate + 0x8140;
    else sjw = intermediate + 0xc140;
    data.payload[data.payloadLen++] = sjw >> 8;
    data.payload[data.payloadLen++] = sjw & 0xff;
  }
  return ERR.SUCCESS;
}

function decodeEci(data, ds) {
  if (bitsRemaining(ds) < 8) return ERR.DATA_UNDERFLOW;
  data.eci = takeBits(ds, 8);

  if ((data.eci & 0xc0) === 0x80) {
    if (bitsRemaining(ds) < 8) return ERR.DATA_UNDERFLOW;
    data.eci = (data.eci << 8) | takeBits(ds, 8);
  } else if ((data.eci & 0xe0) === 0xc0) {
    if (bitsRemaining(ds) < 16) return ERR.DATA_UNDERFLOW;
    data.eci = (data.eci << 16) | takeBits(ds, 16);
  }
  return ERR.SUCCESS;
}

function decodePayload(data, ds) {
  while (bitsRemaining(ds) >= 4) {
    let err = ERR.SUCCESS;
    const type = takeBits(ds, 4);

    switch (type) {
      case DATA_TYPE.NUMERIC: err = decodeNumeric(data, ds); break;
      case DATA_TYPE.ALPHA: err = decodeAlpha(data, ds); break;
      case DATA_TYPE.BYTE: err = decodeByte(data, ds); break;
      case DATA_TYPE.KANJI: err = decodeKanji(data, ds); break;
      case 7: err = decodeEci(data, ds); break;
      default: return finishPayload(data);
    }
    if (err) return err;

    if (!(type & (type - 1)) && type > data.dataType) data.dataType = type;
  }
  return finishPayload(data);
}

function finishPayload(data) {
  if (data.payloadLen >= MAX_PAYLOAD) data.payloadLen--;
  data.payload[data.payloadLen] = 0;
  return ERR.SUCCESS;
}

// Decode a located code object {size, cells}. Returns {err, data} where data has
// {version, eccLevel, mask, dataType, eci, payload, payloadLen} on success.
export function decodeCode(code) {
  if (code.size > MAX_GRID_SIZE) return { err: ERR.INVALID_GRID_SIZE, data: null };
  if ((code.size - 17) % 4) return { err: ERR.INVALID_GRID_SIZE, data: null };

  const version = (code.size - 17) / 4;
  if (version < 1 || version > 40) return { err: ERR.INVALID_VERSION, data: null };

  const data = {
    version, eccLevel: 0, mask: 0, dataType: 0, eci: 0,
    payload: new Uint8Array(MAX_PAYLOAD), payloadLen: 0,
  };

  let err = readFormat(code, data, 0);
  if (err) err = readFormat(code, data, 1);
  if (err) return { err, data: null };

  const ds = {
    raw: new Uint8Array(MAX_PAYLOAD),
    data: new Uint8Array(MAX_PAYLOAD),
    dataBits: 0,
    ptr: 0,
  };

  readData(code, data, ds);
  err = codestreamEcc(data, ds);
  if (err) return { err, data: null };

  err = decodePayload(data, ds);
  if (err) return { err, data: null };

  return { err: ERR.SUCCESS, data };
}

export { gridSizeOf };
