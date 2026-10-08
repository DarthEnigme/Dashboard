/**
 * Displacement maps for the "liquid" style, one per pane size: a rounded-rectangle lens whose rim
 * (the bezel) bends the backdrop inward, strongest at the very edge and flat in the middle, the way
 * a thick pane of glass does. The map follows the pane's corner radius, and the bezel keeps the same
 * width in pixels on a small button and on a wide card (one stretched map can't do either).
 *
 * Encoding (feDisplacementMap): red = x, green = y, 128 = no shift.
 */

export interface Lens {
  /** Map size in pixels (the pane's size, maybe scaled down). */
  width: number;
  height: number;
  radius: number;
  bezel: number;
}

/** Rim width for a pane: a fifth of its short side, between 10 and 32 px. */
export const bezelFor = (w: number, h: number) => Math.round(Math.min(32, Math.max(10, Math.min(w, h) * 0.2)));

/**
 * RGBA pixels of the map. Inside the bezel the shift points inward along the edge normal, with a
 * convex falloff ((1 - t)², t = depth into the bezel), so the edge magnifies and the middle stays put.
 */
export function lensPixels({ width: w, height: h, radius, bezel }: Lens): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  const r = Math.min(radius, w / 2, h / 2);
  const bx = w / 2 - r;
  const by = h / 2 - r;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Signed distance to the rounded rectangle, from the pixel centre (negative inside).
      const pxc = x + 0.5 - w / 2;
      const pyc = y + 0.5 - h / 2;
      const qx = Math.abs(pxc) - bx;
      const qy = Math.abs(pyc) - by;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const depth = r - (outside + Math.min(Math.max(qx, qy), 0));
      let dx = 0;
      let dy = 0;
      if (depth < bezel) {
        // Outward normal: from the corner arc in the corners, else from the nearest straight edge.
        let nx: number;
        let ny: number;
        if (qx > 0 && qy > 0) {
          nx = (ox / (outside || 1)) * Math.sign(pxc);
          ny = (oy / (outside || 1)) * Math.sign(pyc);
        } else if (qx > qy) {
          nx = Math.sign(pxc);
          ny = 0;
        } else {
          nx = 0;
          ny = Math.sign(pyc);
        }
        const t = Math.max(0, depth) / bezel;
        const m = (1 - t) * (1 - t);
        // Sample from further inside: the rim shows a magnified, bent copy of what is under the middle.
        dx = -nx * m;
        dy = -ny * m;
      }
      px[i] = 128 + Math.round(dx * 127);
      px[i + 1] = 128 + Math.round(dy * 127);
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  return px;
}

const NS = "http://www.w3.org/2000/svg";
/** Each colour channel bends a little differently: a faint prismatic fringe at the rim. */
const CHANNELS = [
  { k: 1.1, matrix: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { k: 1, matrix: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { k: 0.9, matrix: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" },
];

const el = (name: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/**
 * Builds and caches one filter per pane size inside `svg` (the hidden <svg> of PointerLight), and
 * points a pane's --lens at it. Panes bigger than 900 px get a half-resolution map (it is smooth).
 */
export class LensCache {
  private filters = new Map<string, SVGFilterElement>();
  /** Maps being decoded, with the panes waiting for them. */
  private pending = new Map<string, Set<HTMLElement>>();
  constructor(private svg: SVGSVGElement) {}

  apply(pane: HTMLElement) {
    const rect = pane.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    // Sizes are bucketed to 8 px: resizing by a pixel or two reuses the same filter.
    const w = Math.ceil(rect.width / 8) * 8;
    const h = Math.ceil(rect.height / 8) * 8;
    const radius = Math.round(parseFloat(getComputedStyle(pane).borderTopLeftRadius) || 0);
    const key = `${w}x${h}r${radius}`;
    if (this.pending.has(key)) return void this.pending.get(key)!.add(pane);
    if (this.filters.has(key)) {
      pane.style.setProperty("--lens", `url(#lens-${key})`);
      // Most recently used last, so the oldest is dropped first.
      const f = this.filters.get(key)!;
      this.filters.delete(key);
      this.filters.set(key, f);
      return;
    }
    const scale = Math.max(w, h) > 900 ? 0.5 : 1;
    const bezel = bezelFor(w, h);
    const lens = { width: Math.round(w * scale), height: Math.round(h * scale), radius: radius * scale, bezel: bezel * scale };
    const canvas = document.createElement("canvas");
    canvas.width = lens.width;
    canvas.height = lens.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(lensPixels(lens) as Uint8ClampedArray<ArrayBuffer>, lens.width, lens.height), 0, 0);

    // Everything in bounding-box units: for backdrop filters Chromium doesn't anchor user-space
    // coordinates at the pane, so the map is placed as a fraction of the pane's box. Chromium then
    // shifts by scale × the pane's width × (channel − ½) on both axes (measured), so dividing by the
    // width moves the backdrop by up to ~0.6 × bezel px at the rim.
    const shift = (bezel * 1.2) / w;
    const href = canvas.toDataURL();
    const f = el("filter", { id: `lens-${key}`, x: 0, y: 0, width: 1, height: 1, primitiveUnits: "objectBoundingBox", "color-interpolation-filters": "sRGB" }) as SVGFilterElement;
    f.append(el("feImage", { href, x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: "none", result: "map" }));
    CHANNELS.forEach((c, i) =>
      f.append(el("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale: (shift * c.k).toFixed(4), xChannelSelector: "R", yChannelSelector: "G", result: `d${i}` })),
    );
    CHANNELS.forEach((c, i) => f.append(el("feColorMatrix", { in: `d${i}`, type: "matrix", values: c.matrix, result: `c${i}` })));
    f.append(el("feBlend", { in: "c0", in2: "c1", mode: "screen", result: "rg" }), el("feBlend", { in: "rg", in2: "c2", mode: "screen" }));
    // Chromium paints a backdrop filter whose image isn't decoded yet as a smear, and doesn't repaint
    // when it arrives: decode first, then hand the filter to the panes (they keep the generic one meanwhile).
    const waiting = new Set([pane]);
    this.pending.set(key, waiting);
    const img = new Image();
    img.src = href;
    img
      .decode()
      .catch(() => undefined)
      .then(() => {
        this.svg.append(f);
        this.filters.set(key, f);
        // Two frames for the filter's own copy of the image to be ready too.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            this.pending.delete(key);
            for (const p of waiting) if (p.isConnected) p.style.setProperty("--lens", `url(#lens-${key})`);
            this.evict();
          }),
        );
      });
  }

  private evict() {
    if (this.filters.size > 96) {
      const [oldest, node] = this.filters.entries().next().value!;
      this.filters.delete(oldest);
      node.remove();
    }
  }
}
