"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTRIES, countryIndex, DOTS } from "@/lib/travel/geo";
import { useWidth } from "../charts/common";
import { useT } from "@/i18n/client";

export interface GlobeCity {
  lat: number;
  lon: number;
  label: string;
}

interface Props {
  visited: Set<string>;
  wanted: Set<string>;
  cities: GlobeCity[];
  selected?: string;
  onSelect: (code: string | undefined) => void;
  /** Flat world map instead of the globe. */
  flat?: boolean;
}

const RAD = Math.PI / 180;
// Land dots in radians, decoded once.
const LON = new Float32Array(DOTS.length / 3);
const LAT = new Float32Array(DOTS.length / 3);
const IDX = new Uint16Array(DOTS.length / 3);
for (let i = 0, j = 0; i < DOTS.length; i += 3, j++) {
  LON[j] = (DOTS[i] / 10) * RAD;
  LAT[j] = (DOTS[i + 1] / 10) * RAD;
  IDX[j] = DOTS[i + 2];
}

const cssColor = (el: Element, name: string, fallback: string) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

/**
 * The countries you've been to on a dotted globe: land in faint dots, visited countries in the
 * accent colour, wish-list ones outlined, cities as glowing points. Spins slowly (not with reduced
 * motion), drags to turn, and a click picks the country under the pointer.
 */
export function Globe({ visited, wanted, cities, selected, onSelect, flat }: Props) {
  const t = useT();
  const [box, width] = useWidth<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  // Rotation: λ turns the earth, φ tilts it. Kept in refs so the animation loop doesn't re-render.
  const view = useRef({ lambda: -10 * RAD, phi: 25 * RAD, target: null as null | { lambda: number; phi: number } });
  const drag = useRef<{ x: number; y: number; lambda: number; phi: number; moved: boolean } | null>(null);
  const hover = useRef(false);
  const [reduced, setReduced] = useState(false);
  const height = flat ? Math.round(width / 2) : Math.min(width, 520);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Turn to the selected country.
  useEffect(() => {
    const c = selected ? COUNTRIES[countryIndex(selected)] : undefined;
    if (c && !flat) view.current.target = { lambda: -c.lon * RAD, phi: Math.max(-60, Math.min(60, c.lat)) * RAD };
  }, [selected, flat]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !width) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let colors = { fg: "#fff", accent: "#8b5cf6" };
    let colorAt = 0;

    const draw = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (now - colorAt > 500) {
        colors = { fg: cssColor(el, "--fg", "#f4f4f5"), accent: cssColor(el, "--accent", "#8b5cf6") };
        colorAt = now;
      }
      const v = view.current;
      if (v.target) {
        const k = reduced ? 1 : Math.min(1, dt / 220);
        const dl = ((v.target.lambda - v.lambda + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        v.lambda += dl * k;
        v.phi += (v.target.phi - v.phi) * k;
        if (Math.abs(dl) < 0.002 && Math.abs(v.target.phi - v.phi) < 0.002) v.target = null;
      } else if (!reduced && !drag.current && !hover.current && !flat) v.lambda += dt * 0.00012;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const sel = selected ? countryIndex(selected) : -1;
      const status = (i: number) => {
        const code = COUNTRIES[i]?.code;
        return code && visited.has(code) ? 2 : code && wanted.has(code) ? 1 : 0;
      };

      if (flat) {
        const dot = Math.max(1.1, width / 520);
        for (let j = 0; j < LON.length; j++) {
          const x = ((LON[j] / RAD + 180) / 360) * width;
          const y = ((90 - LAT[j] / RAD) / 180) * height;
          paint(ctx, x, y, dot, status(IDX[j]), IDX[j] === sel, 1, colors);
        }
        ctx.globalAlpha = 1;
        for (const c of cities) glow(ctx, ((c.lon + 180) / 360) * width, ((90 - c.lat) / 180) * height, dot * 1.6, colors.accent);
      } else {
        const r = Math.min(width, height) / 2 - 8;
        const cx = width / 2;
        const cy = height / 2;
        const cosP = Math.cos(v.phi);
        const sinP = Math.sin(v.phi);
        // The sphere itself: a faint disc and rim, so the globe reads as round.
        // (Canvas colours can't be color-mix(): transparency comes from globalAlpha.)
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = colors.fg;
        ctx.fill();
        ctx.globalAlpha = 0.14;
        ctx.strokeStyle = colors.fg;
        ctx.lineWidth = 1;
        ctx.stroke();
        const project = (lon: number, lat: number) => {
          const l = lon + v.lambda;
          const x = Math.cos(lat) * Math.sin(l);
          const y = Math.sin(lat);
          const z = Math.cos(lat) * Math.cos(l);
          return { x: cx + x * r, y: cy - (y * cosP - z * sinP) * r, z: y * sinP + z * cosP };
        };
        const dot = Math.max(1.1, r / 190);
        for (let j = 0; j < LON.length; j++) {
          const p = project(LON[j], LAT[j]);
          if (p.z <= 0) continue;
          paint(ctx, p.x, p.y, dot, status(IDX[j]), IDX[j] === sel, 0.3 + 0.7 * p.z, colors);
        }
        ctx.globalAlpha = 1;
        for (const c of cities) {
          const p = project(c.lon * RAD, c.lat * RAD);
          if (p.z > 0) glow(ctx, p.x, p.y, dot * 1.7, colors.accent);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, visited, wanted, cities, selected, flat, reduced]);

  /** The country of the land dot nearest the pointer, if one is close. */
  const pick = (clientX: number, clientY: number) => {
    const el = canvas.current!;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best = -1;
    let bestD = 12 * 12;
    if (flat) {
      for (let j = 0; j < LON.length; j++) {
        const dx = ((LON[j] / RAD + 180) / 360) * width - px;
        const dy = ((90 - LAT[j] / RAD) / 180) * height - py;
        if (dx * dx + dy * dy < bestD) (bestD = dx * dx + dy * dy), (best = IDX[j]);
      }
    } else {
      const v = view.current;
      const r = Math.min(width, height) / 2 - 8;
      const cosP = Math.cos(v.phi);
      const sinP = Math.sin(v.phi);
      for (let j = 0; j < LON.length; j++) {
        const l = LON[j] + v.lambda;
        const x = Math.cos(LAT[j]) * Math.sin(l);
        const y = Math.sin(LAT[j]);
        const z = Math.cos(LAT[j]) * Math.cos(l);
        if (y * sinP + z * cosP <= 0) continue;
        const dx = width / 2 + x * r - px;
        const dy = height / 2 - (y * cosP - z * sinP) * r - py;
        if (dx * dx + dy * dy < bestD) (bestD = dx * dx + dy * dy), (best = IDX[j]);
      }
    }
    return best >= 0 ? COUNTRIES[best]?.code : undefined;
  };

  return (
    <div ref={box} className="relative w-full" style={{ height: height || 320 }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t("Map of the countries you have visited")}
        data-visited={visited.size}
        style={{ width, height, touchAction: "none", cursor: flat ? "pointer" : "grab" }}
        className="mx-auto block"
        onPointerEnter={() => (hover.current = true)}
        onPointerLeave={() => {
          hover.current = false;
          drag.current = null;
        }}
        onPointerDown={(e) => {
          if (flat) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, lambda: view.current.lambda, phi: view.current.phi, moved: false };
          view.current.target = null;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          const speed = Math.PI / Math.max(200, width);
          view.current.lambda = d.lambda + dx * speed;
          view.current.phi = Math.max(-1.2, Math.min(1.2, d.phi + dy * speed));
        }}
        onPointerUp={(e) => {
          const moved = drag.current?.moved;
          drag.current = null;
          if (!moved) onSelect(pick(e.clientX, e.clientY));
        }}
        onClick={(e) => flat && onSelect(pick(e.clientX, e.clientY))}
      />
    </div>
  );
}

function paint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, status: number, selected: boolean, light: number, c: { fg: string; accent: string }) {
  ctx.beginPath();
  // Visited countries are drawn a little bigger, so small ones (Portugal, Japan) still stand out.
  ctx.arc(x, y, selected ? r * 1.35 : status === 2 ? r * 1.3 : r, 0, Math.PI * 2);
  if (status === 2 || selected) {
    ctx.globalAlpha = (selected ? 1 : 0.9) * light;
    ctx.fillStyle = selected && status !== 2 ? c.fg : c.accent;
    ctx.fill();
  } else if (status === 1) {
    ctx.globalAlpha = 0.85 * light;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.28 * light;
    ctx.fillStyle = c.fg;
    ctx.fill();
  }
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 4;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
