import { ImageResponse } from "next/og";
import { loadConfig } from "@/lib/config/load";
import { serverAccent } from "@/lib/theme";

export const dynamic = "force-dynamic";

const SIZES = [180, 192, 512];

/** App icon: the title's first letter on an accent gradient. Maskable icons get extra safe-zone padding. */
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.includes(size)) return new Response("Not found", { status: 404 });
  const maskable = new URL(req.url).searchParams.has("maskable");
  const { settings } = loadConfig();
  const accent = serverAccent(settings.accent, settings.background.gradient);
  const letter = (settings.title.trim()[0] ?? "P").toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b14",
        }}
      >
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
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
