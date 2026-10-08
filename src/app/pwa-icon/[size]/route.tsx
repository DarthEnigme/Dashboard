import { ImageResponse } from "next/og";
import { loadConfig } from "@/lib/config/load";
import { iconLogo } from "@/lib/logo";
import { serverAccent } from "@/lib/theme";

export const dynamic = "force-dynamic";

const SIZES = [180, 192, 512];

/**
 * App icon: the logo (settings.logo) when there is a PNG or JPEG one, otherwise the title's first
 * letter on an accent gradient. Maskable icons get extra safe-zone padding.
 */
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.includes(size)) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const maskable = q.has("maskable");
  const { settings } = loadConfig();
  const accent = serverAccent(settings.accent, settings.background.gradient);
  const letter = (settings.title.trim()[0] ?? "P").toUpperCase();
  const logo = iconLogo(settings.logo);
  const inner = Math.round(size * (maskable ? 0.7 : 1));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: logo && !maskable ? "transparent" : "#0b0b14",
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={inner} height={inner} style={{ objectFit: "contain", borderRadius: maskable ? "22%" : "18%" }} alt="" />
        ) : (
          <div
            style={{
              width: maskable ? "70%" : "100%",
              height: maskable ? "70%" : "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: maskable ? "28%" : "22%",
              background: `linear-gradient(135deg, ${accent}, #0b0b14)`,
              color: "white",
              fontSize: size * (maskable ? 0.36 : 0.5),
              fontWeight: 700,
            }}
          >
            {letter}
          </div>
        )}
      </div>
    ),
    // Versioned URLs (?v=, see lib/logo.ts) can be kept long; a new logo gets a new URL.
    { width: size, height: size, headers: { "Cache-Control": q.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=3600" } },
  );
}
