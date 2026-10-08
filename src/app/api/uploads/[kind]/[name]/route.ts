import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string; name: string }> };

/** Uploaded images are public (the wallpaper shows to anonymous viewers); names are random and never reused. */
export async function GET(_req: Request, { params }: Ctx) {
  const { kind, name } = await params;
  const file = readUpload(kind, name);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
