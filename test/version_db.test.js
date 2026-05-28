import test from "node:test";
import assert from "node:assert/strict";
import { VERSION_DB, gridSize, eccParams, MAX_VERSION } from "../src/version_db.js";

test("table shape", () => {
  assert.equal(VERSION_DB.length, MAX_VERSION + 1);
  assert.equal(VERSION_DB[0], null);
  for (let v = 1; v <= MAX_VERSION; v++) assert.ok(VERSION_DB[v], `v${v} present`);
});

test("grid sizes (4V+17)", () => {
  assert.equal(gridSize(1), 21);
  assert.equal(gridSize(7), 45);
  assert.equal(gridSize(40), 177);
});

test("alignment-pattern coords for known versions", () => {
  assert.deepEqual(VERSION_DB[1].apat, []);
  assert.deepEqual(VERSION_DB[7].apat, [6, 22, 38]);
  assert.deepEqual(VERSION_DB[40].apat, [6, 30, 58, 86, 114, 142, 170]);
});

test("data_bytes (total codewords) for known versions", () => {
  assert.equal(VERSION_DB[1].dataBytes, 26);
  assert.equal(VERSION_DB[7].dataBytes, 196);
  assert.equal(VERSION_DB[40].dataBytes, 3706);
});

// Strong self-consistency check that catches most transcription errors: for every
// version and EC level, the block layout must exactly tile the total codewords.
test("RS block layout tiles total codewords for all v x level", () => {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const total = VERSION_DB[v].dataBytes;
    for (let lvl = 0; lvl < 4; lvl++) {
      const { bs, dw, ns } = eccParams(v, lvl);
      const num = total - bs * ns;
      assert.ok(num >= 0, `v${v} lvl${lvl}: bs*ns <= total`);
      assert.equal(num % (bs + 1), 0, `v${v} lvl${lvl}: large blocks divide evenly`);
      const lbCount = num / (bs + 1);
      assert.equal(bs * ns + (bs + 1) * lbCount, total,
        `v${v} lvl${lvl}: blocks reconstruct total`);
      assert.ok(dw < bs, `v${v} lvl${lvl}: data words < block size`);
    }
  }
});
