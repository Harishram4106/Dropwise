import type { CSSProperties } from "react";

export type Pt = [number, number];
export type Iso = (x: number, y: number, z?: number) => Pt;

export const COS30 = 0.8660254;

/** Isometric projection: +x runs down-right, +y runs down-left, +z runs up. */
export function createIso(cx: number, cy: number, scale = 1): Iso {
  return (x, y, z = 0) => [
    cx + (x - y) * COS30 * scale,
    cy + ((x + y) * 0.5 - z) * scale,
  ];
}

const f = (n: number) => n.toFixed(1);

export const poly = (ps: Pt[]) => ps.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

export const pathOf = (ps: Pt[], close = false) =>
  "M" + ps.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L") + (close ? " Z" : "");

/** The three visible faces of a box spanning x..x+w, y..y+d, z..z+h. */
export function box(iso: Iso, x: number, y: number, z: number, w: number, d: number, h: number) {
  const t = z + h;
  return {
    top: poly([iso(x, y, t), iso(x + w, y, t), iso(x + w, y + d, t), iso(x, y + d, t)]),
    right: poly([iso(x + w, y, t), iso(x + w, y + d, t), iso(x + w, y + d, z), iso(x + w, y, z)]),
    left: poly([iso(x, y + d, t), iso(x + w, y + d, t), iso(x + w, y + d, z), iso(x, y + d, z)]),
  };
}

export type Box = ReturnType<typeof box>;

/** Flat square outline lying in the plane at height z. */
export const square = (iso: Iso, half: number, z = 0) =>
  poly([iso(-half, -half, z), iso(half, -half, z), iso(half, half, z), iso(-half, half, z)]);

/** SVG transform that maps flat (x, y) plane coordinates at height z onto screen space. */
export function planeMatrix(iso: Iso, z = 0) {
  const [tx, ty] = iso(0, 0, z);
  const [ax, ay] = iso(1, 0, z);
  const [bx, by] = iso(0, 1, z);
  return `matrix(${ax - tx} ${ay - ty} ${bx - tx} ${by - ty} ${f(tx)} ${f(ty)})`;
}

/** Inline CSS delay variable used by the draw / fade animations. */
export const delay = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;
