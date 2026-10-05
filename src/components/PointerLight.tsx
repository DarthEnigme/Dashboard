"use client";

import { useEffect } from "react";

// Displacement map: neutral grey in the middle, pushing inward along each edge (red = x, green = y),
// so the backdrop is magnified and bent at the rim of every pane like the edge of a lens.
const map = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
<defs>
<linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="rgb(220,0,0)"/><stop offset=".1" stop-color="rgb(128,0,0)"/><stop offset=".9" stop-color="rgb(128,0,0)"/><stop offset="1" stop-color="rgb(36,0,0)"/></linearGradient>
<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgb(0,220,0)"/><stop offset=".14" stop-color="rgb(0,128,0)"/><stop offset=".86" stop-color="rgb(0,128,0)"/><stop offset="1" stop-color="rgb(0,36,0)"/></linearGradient>
</defs>
<rect width="100" height="100" fill="url(#x)"/>
<rect width="100" height="100" fill="url(#y)" style="mix-blend-mode:screen"/>
</svg>`;
const mapUrl = `data:image/svg+xml,${encodeURIComponent(map)}`;

/** Only Chromium renders SVG filters in backdrop-filter; elsewhere the CSS-only liquid style is used. */
function canRefract() {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
  return !!brands?.some((b) => b.brand === "Chromium");
}

/** Each colour channel is bent a little differently, which gives the rim a faint prismatic fringe. */
const channels = [
  { scale: 0.066, matrix: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { scale: 0.06, matrix: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { scale: 0.054, matrix: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" },
];

/**
 * Pointer light for every card style: the hovered `.glass` pane gets `data-lit` and the pointer
 * position (--mx/--my, in %) and angle from its centre (--ang), which drive the edge spotlight,
 * the liquid specular highlight and the colour-shifting liquid rim (globals.css).
 * Also holds the refraction filter of the "liquid" style. Always mounted so a style change previewed
 * in the settings applies without a reload.
 */
export function PointerLight() {
  useEffect(() => {
    const root = document.documentElement;
    if (canRefract()) root.dataset.refract = "";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let last: PointerEvent | undefined;
    let lit: HTMLElement | null = null;
    const setLit = (el: HTMLElement | null) => {
      if (el === lit) return;
      if (lit) {
        delete lit.dataset.lit;
        // Leave the position where it was so the light fades out in place.
      }
      lit = el;
      if (lit) lit.dataset.lit = "";
    };
    const update = () => {
      frame = 0;
      const el = last?.target instanceof Element ? last.target.closest<HTMLElement>(".glass") : null;
      setLit(el);
      if (!el || !last) return;
      const r = el.getBoundingClientRect();
      const x = (last.clientX - r.left) / r.width;
      const y = (last.clientY - r.top) / r.height;
      el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      // Angle measured like conic-gradient: 0deg points up, clockwise.
      const ang = (Math.atan2(x - 0.5, -(y - 0.5)) * 180) / Math.PI;
      el.style.setProperty("--ang", `${ang.toFixed(1)}deg`);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || (root.dataset.glow === "none" && root.dataset.style !== "liquid")) return setLit(null);
      last = e;
      frame ||= requestAnimationFrame(update);
    };
    const onLeave = () => setLit(null);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
      setLit(null);
    };
  }, []);

  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }}>
      <filter id="liquid-refract" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
        <feImage href={mapUrl} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        {channels.map((c, i) => (
          <feDisplacementMap key={`d${i}`} in="SourceGraphic" in2="map" scale={c.scale} xChannelSelector="R" yChannelSelector="G" result={`d${i}`} />
        ))}
        {channels.map((c, i) => (
          <feColorMatrix key={`c${i}`} in={`d${i}`} type="matrix" values={c.matrix} result={`c${i}`} />
        ))}
        <feBlend in="c0" in2="c1" mode="screen" result="rg" />
        <feBlend in="rg" in2="c2" mode="screen" />
      </filter>
    </svg>
  );
}
