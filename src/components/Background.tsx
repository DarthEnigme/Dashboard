import type { CSSProperties } from "react";
import type { ClientSettings } from "@/lib/config/sanitize";
import { gradientColors } from "@/lib/theme";
import { AutoAccent } from "./AutoAccent";

const blobLayout: CSSProperties[] = [
  { top: "-15%", left: "-10%", width: "55vw", height: "55vw" },
  { bottom: "-20%", right: "-10%", width: "50vw", height: "50vw", animationDelay: "-9s" },
  { top: "30%", left: "35%", width: "35vw", height: "35vw", animationDelay: "-17s" },
];

// Fixed bubble layout (no randomness: the server and browser must render the same markup).
// [left %, size px, rise seconds, delay seconds]
const bubbles: [number, number, number, number][] = [
  [6, 38, 34, 0], [14, 18, 26, -12], [22, 56, 42, -30], [31, 24, 30, -5], [40, 14, 24, -18],
  [48, 44, 38, -22], [57, 20, 28, -9], [64, 66, 46, -36], [72, 16, 25, -3], [79, 30, 33, -27],
  [86, 50, 40, -14], [93, 22, 29, -20],
];

/** The "aero" background: sky, horizon glow, light ribbons and slowly rising bubbles (all CSS). */
function AeroSky() {
  return (
    <div className="bg-aero absolute inset-0">
      <svg className="aero-ribbon" viewBox="0 0 1200 400" preserveAspectRatio="none" fill="none" stroke="currentColor">
        <path d="M0 300 C 250 180, 450 380, 700 240 S 1100 150, 1200 210" strokeWidth="2.5" />
        <path d="M0 330 C 300 230, 500 400, 760 270 S 1080 200, 1200 250" strokeWidth="1.5" opacity=".7" />
        <path d="M0 260 C 200 160, 520 330, 820 200 S 1120 120, 1200 160" strokeWidth="1" opacity=".5" />
      </svg>
      {bubbles.map(([left, size, dur, delay], i) => (
        <span
          key={i}
          className="aero-bubble"
          style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}

export function Background({ settings }: { settings: ClientSettings }) {
  const { image, gradient, blur, brightness } = settings.background;
  const preset = gradientColors[gradient] ?? gradientColors.aurora;

  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      {image && settings.accent === "auto" && <AutoAccent image={image} />}
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ filter: `blur(${blur}px) brightness(${brightness})`, transform: blur ? "scale(1.06)" : undefined }}
        />
      ) : gradient === "aero" ? (
        <AeroSky />
      ) : (
        <div className="bg-preset absolute inset-0" style={{ "--preset-base": preset.base } as CSSProperties}>
          {preset.blobs.map((color, i) => (
            <div key={i} className="blob" style={{ ...blobLayout[i], background: color }} />
          ))}
        </div>
      )}
      <div className="absolute inset-0" style={{ background: "var(--scrim)" }} />
      {/* subtle grain keeps large gradients from banding */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
