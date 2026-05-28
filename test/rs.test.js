import test from "node:test";
import assert from "node:assert/strict";
import { GF16, GF256 } from "../src/gf.js";
import { correctFormat } from "../src/rs.js";
import { ERR } from "../src/errors.js";

test("GF256 log/exp are inverses", () => {
  for (let x = 1; x < 256; x++) {
    assert.equal(GF256.exp[GF256.log[x]], x, `exp(log(${x}))`);
  }
  // exp is cyclic with period 255.
  assert.equal(GF256.exp[0], 1);
  assert.equal(GF256.exp[255], 1);
});

test("GF16 log/exp are inverses", () => {
  for (let x = 1; x < 16; x++) {
    assert.equal(GF16.exp[GF16.log[x]], x, `exp(log(${x}))`);
  }
});

// Independent BCH(15,5) format encoder (generator x^10+x^8+x^5+x^4+x^2+x+1 = 0x537),
// matching ISO 18004. Returns the *unmasked* BCH codeword — i.e. what correctFormat
// operates on, since readFormat strips the 0x5412 format mask before correcting.
function encodeFormat(fdata) {
  let rem = fdata << 10;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  }
  return (fdata << 10) | rem;
}

test("correctFormat decodes all 32 valid format strings", () => {
  for (let fdata = 0; fdata < 32; fdata++) {
    const cw = encodeFormat(fdata);
    const { err, value } = correctFormat(cw);
    assert.equal(err, ERR.SUCCESS, `fdata=${fdata} clean`);
    assert.equal(value >> 10, fdata, `fdata=${fdata} recovered`);
  }
});

test("correctFormat fixes 1- to 3-bit errors", () => {
  const fdata = 0b01010; // arbitrary (EC + mask) field
  const cw = encodeFormat(fdata);
  for (const flips of [[3], [3, 9], [1, 7, 13]]) {
    let bad = cw;
    for (const b of flips) bad ^= (1 << b);
    const { err, value } = correctFormat(bad);
    assert.equal(err, ERR.SUCCESS, `flips ${flips}`);
    assert.equal(value >> 10, fdata, `flips ${flips} recovered fdata`);
  }
});
