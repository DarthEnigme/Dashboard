/**
 * Save an on-page chart as a file. Charts draw with CSS variables and utility classes, which mean
 * nothing outside the page, so the copy gets every resolved colour and font written onto it.
 */

const PAINT = ["fill", "stroke", "opacity", "fill-opacity", "stroke-opacity", "stroke-width", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline"] as const;

/** A standalone SVG document of `svg`, on the page's background colour. */
export function standaloneSvg(svg: SVGSVGElement, opts: { background?: string; padding?: number } = {}): { markup: string; width: number; height: number } {
  const pad = opts.padding ?? 16;
  const box = svg.getBoundingClientRect();
  // overflow-visible charts draw a little outside their box (labels): include it.
  const bbox = svg.getBBox();
  const x0 = Math.min(0, bbox.x) - pad;
  const y0 = Math.min(0, bbox.y) - pad;
  const width = Math.ceil(Math.max(box.width, bbox.x + bbox.width) - x0 + pad);
  const height = Math.ceil(Math.max(box.height, bbox.y + bbox.height) - y0 + pad);

  const copy = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")];
  const copies = [copy, ...copy.querySelectorAll("*")];
  originals.forEach((el, i) => {
    const target = copies[i] as SVGElement;
    const cs = getComputedStyle(el);
    for (const p of PAINT) {
      const v = cs.getPropertyValue(p);
      if (v) target.style.setProperty(p, v);
    }
    target.removeAttribute("class");
    // Attributes like fill="var(--fg)" only resolve in the page.
    for (const attr of ["fill", "stroke"]) if (target.getAttribute(attr)?.includes("var(")) target.removeAttribute(attr);
  });

  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  copy.setAttribute("viewBox", `${x0} ${y0} ${width} ${height}`);
  copy.removeAttribute("style");
  const bg = opts.background ?? getComputedStyle(document.body).backgroundColor;
  if (bg) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    Object.entries({ x: x0, y: y0, width, height, fill: bg }).forEach(([k, v]) => rect.setAttribute(k, String(v)));
    copy.insertBefore(rect, copy.firstChild);
  }
  return { markup: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`, width, height };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svg: SVGSVGElement, name: string) {
  downloadBlob(new Blob([standaloneSvg(svg).markup], { type: "image/svg+xml" }), name);
}

/** PNG at `scale`× (sharp on high-density screens and in documents). */
export async function downloadPng(svg: SVGSVGElement, name: string, scale = 2) {
  const { markup, width, height } = standaloneSvg(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not draw the chart"));
      img.src = url;
    });
    const canvas = Object.assign(document.createElement("canvas"), { width: width * scale, height: height * scale });
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the PNG");
    downloadBlob(blob, name);
  } finally {
    URL.revokeObjectURL(url);
  }
}
