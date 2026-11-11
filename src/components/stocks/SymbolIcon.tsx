"use client";

import { useState } from "react";

const SERIES = 8;

/** A stable colour per symbol, from the chart series. */
const colorOf = (symbol: string) => `var(--series-${([...symbol].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % SERIES) + 1})`;

/** Up to two letters: "MC" for MC.PA, "GS" for ^GSPC, "AA" for AAPL. */
const initials = (symbol: string) => symbol.replace(/[^A-Z0-9]/g, "").slice(0, 2) || "?";

export const logoHref = (symbol: string) => `/api/stocks/logo/${encodeURIComponent(symbol)}`;

/** A symbol's logo, or its initials on its colour when there is none. Decorative: the symbol is always written next to it. */
export function SymbolIcon({ symbol, size = 28, className = "" }: { symbol: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (failed)
    return (
      <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`} style={{ ...box, background: colorOf(symbol), fontSize: size * 0.36 }}>
        {initials(symbol)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own API, small, cached privately
    <img src={logoHref(symbol)} alt="" aria-hidden loading="lazy" onError={() => setFailed(true)} className={`shrink-0 rounded-full bg-white object-contain p-0.5 ${className}`} style={box} />
  );
}
