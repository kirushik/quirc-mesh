import test from "node:test";
import assert from "node:assert/strict";
import { perspectiveSetup, perspectiveMap, perspectiveMapF, perspectiveUnmap } from "../src/perspective.js";

// An irregular (non-affine) quad to exercise the projective terms.
const rect = [
  { x: 100, y: 120 },  // (0,0)
  { x: 540, y: 90 },   // (w,0)
  { x: 600, y: 560 },  // (w,h)
  { x: 130, y: 600 },  // (0,h)
];
const W = 25, H = 25;

test("maps grid corners to the quad corners", () => {
  const c = perspectiveSetup(rect, W, H);
  const got = [
    perspectiveMap(c, 0, 0),
    perspectiveMap(c, W, 0),
    perspectiveMap(c, W, H),
    perspectiveMap(c, 0, H),
  ];
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(got[i].x - rect[i].x) <= 1, `corner ${i} x`);
    assert.ok(Math.abs(got[i].y - rect[i].y) <= 1, `corner ${i} y`);
  }
});

test("map then unmap is the identity (within float tolerance)", () => {
  const c = perspectiveSetup(rect, W, H);
  for (const [u, v] of [[1, 1], [12.5, 3.7], [24, 24], [7, 20], [0.5, 0.5]]) {
    const p = perspectiveMapF(c, u, v);
    const { u: u2, v: v2 } = perspectiveUnmap(c, p);
    assert.ok(Math.abs(u - u2) < 1e-6, `u ${u} -> ${u2}`);
    assert.ok(Math.abs(v - v2) < 1e-6, `v ${v} -> ${v2}`);
  }
});
