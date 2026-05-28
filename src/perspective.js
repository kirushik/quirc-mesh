// Perspective (projective) transform — direct port of quirc identify.c
// perspective_setup / perspective_map / perspective_unmap.
//
// A transform is an 8-element array c[0..7] mapping module/grid coords (u,v) to
// image pixel coords (x,y):
//     den = c6*u + c7*v + 1
//     x = (c0*u + c1*v + c2) / den
//     y = (c3*u + c4*v + c5) / den

// Round-half-to-even, matching C's rint() default rounding mode.
export function rint(x) {
  const r = Math.round(x); // ties toward +Infinity
  if (Math.abs(x - Math.trunc(x)) === 0.5) {
    const f = Math.floor(x);
    return f % 2 === 0 ? f : f + 1;
  }
  return r;
}

// rect: array of 4 points {x,y} (the quad corners in image space).
// w,h: the source rectangle size (grid units) the quad maps from.
export function perspectiveSetup(rect, w, h) {
  const x0 = rect[0].x, y0 = rect[0].y;
  const x1 = rect[1].x, y1 = rect[1].y;
  const x2 = rect[2].x, y2 = rect[2].y;
  const x3 = rect[3].x, y3 = rect[3].y;

  const wden = 1 / (w * (x2 * y3 - x3 * y2 + (x3 - x2) * y1 + x1 * (y2 - y3)));
  const hden = 1 / (h * (x2 * y3 + x1 * (y2 - y3) - x3 * y2 + (x3 - x2) * y1));

  const c = new Float64Array(8);
  c[0] = (x1 * (x2 * y3 - x3 * y2) + x0 * (-x2 * y3 + x3 * y2 + (x2 - x3) * y1) +
          x1 * (x3 - x2) * y0) * wden;
  c[1] = -(x0 * (x2 * y3 + x1 * (y2 - y3) - x2 * y1) - x1 * x3 * y2 + x2 * x3 * y1 +
          (x1 * x3 - x2 * x3) * y0) * hden;
  c[2] = x0;
  c[3] = (y0 * (x1 * (y3 - y2) - x2 * y3 + x3 * y2) + y1 * (x2 * y3 - x3 * y2) +
          x0 * y1 * (y2 - y3)) * wden;
  c[4] = (x0 * (y1 * y3 - y2 * y3) + x1 * y2 * y3 - x2 * y1 * y3 +
          y0 * (x3 * y2 - x1 * y2 + (x2 - x3) * y1)) * hden;
  c[5] = y0;
  c[6] = (x1 * (y3 - y2) + x0 * (y2 - y3) + (x2 - x3) * y1 + (x3 - x2) * y0) * wden;
  c[7] = (-x2 * y3 + x1 * y3 + x3 * y2 + x0 * (y1 - y2) - x3 * y1 + (x2 - x1) * y0) * hden;
  return c;
}

// Map (u,v) -> integer pixel {x,y} (rounded), as quirc's perspective_map.
export function perspectiveMap(c, u, v) {
  const den = 1 / (c[6] * u + c[7] * v + 1.0);
  const x = (c[0] * u + c[1] * v + c[2]) * den;
  const y = (c[3] * u + c[4] * v + c[5]) * den;
  return { x: rint(x), y: rint(y) };
}

// Same map but returning floating-point pixel coords (for sub-pixel sampling).
export function perspectiveMapF(c, u, v) {
  const den = 1 / (c[6] * u + c[7] * v + 1.0);
  return {
    x: (c[0] * u + c[1] * v + c[2]) * den,
    y: (c[3] * u + c[4] * v + c[5]) * den,
  };
}

// Inverse: pixel {x,y} -> grid {u,v}, as quirc's perspective_unmap.
export function perspectiveUnmap(c, pt) {
  const x = pt.x, y = pt.y;
  const den = 1 / (-c[0] * c[7] * y + c[1] * c[6] * y + (c[3] * c[7] - c[4] * c[6]) * x +
                   c[0] * c[4] - c[1] * c[3]);
  const u = -(c[1] * (y - c[5]) - c[2] * c[7] * y + (c[5] * c[7] - c[4]) * x + c[2] * c[4]) * den;
  const v = (c[0] * (y - c[5]) - c[2] * c[6] * y + (c[5] * c[6] - c[3]) * x + c[2] * c[3]) * den;
  return { u, v };
}
