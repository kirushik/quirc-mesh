// Reed-Solomon error correction — port of quirc decode.c (correct_block / correct_format).
import { GF16, GF256, MAX_POLY, polyEval, berlekampMassey } from "./gf.js";
import { ERR } from "./errors.js";

// Compute syndrome vector s[0..npar-1] for a block of `bs` codewords. Returns
// nonzero (truthy) if any syndrome is nonzero (i.e. errors present).
function blockSyndromes(data, bs, npar, s) {
  s.fill(0);
  let nonzero = 0;
  for (let i = 0; i < npar; i++) {
    for (let j = 0; j < bs; j++) {
      const c = data[bs - j - 1];
      if (!c) continue;
      s[i] ^= GF256.exp[(GF256.log[c] + i * j) % 255];
    }
    if (s[i]) nonzero = 1;
  }
  return nonzero;
}

function elocPoly(omega, s, sigma, npar) {
  omega.fill(0);
  for (let i = 0; i < npar; i++) {
    const a = sigma[i];
    if (!a) continue;
    const logA = GF256.log[a];
    for (let j = 0; j + 1 < MAX_POLY; j++) {
      const b = s[j + 1];
      if (i + j >= npar) break;
      if (!b) continue;
      omega[i + j] ^= GF256.exp[(logA + GF256.log[b]) % 255];
    }
  }
}

// Correct a single RS block in place. ecc = {bs, dw}. Returns an ERR code.
export function correctBlock(data, ecc) {
  const npar = ecc.bs - ecc.dw;
  const s = new Uint8Array(MAX_POLY);
  const sigma = new Uint8Array(MAX_POLY);
  const sigmaDeriv = new Uint8Array(MAX_POLY);
  const omega = new Uint8Array(MAX_POLY);

  if (!blockSyndromes(data, ecc.bs, npar, s)) return ERR.SUCCESS;

  berlekampMassey(s, npar, GF256, sigma);

  for (let i = 0; i + 1 < MAX_POLY; i += 2) sigmaDeriv[i] = sigma[i + 1];

  elocPoly(omega, s, sigma, npar - 1);

  for (let i = 0; i < ecc.bs; i++) {
    const xinv = GF256.exp[255 - i];
    if (!polyEval(sigma, xinv, GF256)) {
      const sdX = polyEval(sigmaDeriv, xinv, GF256);
      const omegaX = polyEval(omega, xinv, GF256);
      const error = GF256.exp[(255 - GF256.log[sdX] + GF256.log[omegaX]) % 255];
      data[ecc.bs - i - 1] ^= error;
    }
  }

  if (blockSyndromes(data, ecc.bs, npar, s)) return ERR.DATA_ECC;
  return ERR.SUCCESS;
}

const FORMAT_SYNDROMES = 6;
const FORMAT_BITS = 15;

function formatSyndromes(u, s) {
  s.fill(0);
  let nonzero = 0;
  for (let i = 0; i < FORMAT_SYNDROMES; i++) {
    for (let j = 0; j < FORMAT_BITS; j++) {
      if (u & (1 << j)) s[i] ^= GF16.exp[((i + 1) * j) % 15];
    }
    if (s[i]) nonzero = 1;
  }
  return nonzero;
}

// Correct the 15-bit format value. Returns {err, value}.
export function correctFormat(format) {
  let u = format;
  const s = new Uint8Array(MAX_POLY);
  const sigma = new Uint8Array(MAX_POLY);

  if (!formatSyndromes(u, s)) return { err: ERR.SUCCESS, value: u };

  berlekampMassey(s, FORMAT_SYNDROMES, GF16, sigma);

  for (let i = 0; i < 15; i++) {
    if (!polyEval(sigma, GF16.exp[15 - i], GF16)) u ^= (1 << i);
  }

  if (formatSyndromes(u, s)) return { err: ERR.FORMAT_ECC, value: u };
  return { err: ERR.SUCCESS, value: u };
}
