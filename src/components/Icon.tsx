"use client";

import { useState, type CSSProperties } from "react";

const CDN = "https://cdn.jsdelivr.net";

type Source = { kind: "img" | "mask"; url: string };

/**
 * "proxmox"            -> dashboard-icons (svg, then png, then webp)
 * "mdi-docker"         -> Material Design Icons
 * "si-github"          -> Simple Icons
 * "https://..." / "/x" -> as-is
 */
export function iconSources(icon?: string): Source[] {
  if (!icon) return [];
  if (/^(https?:)?\/\//.test(icon) || icon.startsWith("/")) return [{ kind: "img", url: icon }];
  if (icon.startsWith("mdi-")) return [{ kind: "mask", url: `${CDN}/npm/@mdi/svg@7/svg/${icon.slice(4)}.svg` }];
  if (icon.startsWith("si-")) return [{ kind: "mask", url: `${CDN}/npm/simple-icons@15/icons/${icon.slice(3)}.svg` }];
  const m = icon.match(/^(.*)\.(svg|png|webp)$/);
  const name = m ? m[1] : icon;
  const exts = m ? [m[2]] : ["svg", "png", "webp"];
  return exts.map((ext) => ({ kind: "img", url: `${CDN}/gh/homarr-labs/dashboard-icons/${ext}/${name}.${ext}` }));
}

export function Icon({ icon, name, size = 40 }: { icon?: string; name: string; size?: number }) {
  const sources = iconSources(icon);
  const [state, setState] = useState({ icon, index: 0 });
  // Reset the fallback chain when the icon changes (e.g. live preview in the editor).
  const index = state.icon === icon ? state.index : 0;
  const src = sources[index];
  const box: CSSProperties = { width: size, height: size };

  if (!src) {
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
    return (
      <span
        style={{ ...box, fontSize: size * 0.38 }}
        className="grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent/40 font-semibold text-white shadow-inner"
      >
        {initials}
      </span>
    );
  }

  if (src.kind === "mask") {
    return (
      <span style={box} className="grid shrink-0 place-items-center">
        <span
          className="mask-icon block h-[85%] w-[85%] text-fg"
          style={{ "--icon": `url("${src.url}")` } as CSSProperties}
        />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src.url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={box}
      className="icon-img shrink-0 object-contain"
      onError={() => setState({ icon, index: index + 1 })}
    />
  );
}
