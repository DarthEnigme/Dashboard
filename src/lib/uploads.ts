import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

/** Images people upload (wallpapers, profile pictures), kept in data/uploads/<kind>/. */
export const UPLOAD_KINDS = { backgrounds: 15 * 1024 * 1024, avatars: 2 * 1024 * 1024 } as const;
export type UploadKind = keyof typeof UPLOAD_KINDS;

export const isUploadKind = (k: string): k is UploadKind => Object.hasOwn(UPLOAD_KINDS, k);

const TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" } as const;
type Ext = keyof typeof TYPES;

/** Image type from the first bytes, never from the name or the browser's claim. SVG is refused (it can carry scripts). */
export function sniffImage(b: Uint8Array): Ext | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length < 12) return undefined;
  if (b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "avif";
  return undefined;
}

const dir = (kind: UploadKind) => path.join(DATA_DIR, "uploads", kind);
const NAME = /^[a-f0-9]{32}\.(png|jpg|gif|webp|avif)$/;

/** Store an image; resolves to the URL it is served at. Throws a message fit for the user. */
export async function saveUpload(kind: UploadKind, file: Blob): Promise<string> {
  const max = UPLOAD_KINDS[kind];
  if (file.size > max) throw new Error(`File too large (${Math.round(max / 1024 / 1024)} MB max)`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) throw new Error("Not a supported image (PNG, JPEG, WebP, GIF or AVIF)");
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  fs.mkdirSync(dir(kind), { recursive: true });
  fs.writeFileSync(path.join(dir(kind), name), bytes);
  return `/api/uploads/${kind}/${name}`;
}

/** The file behind an upload URL, or undefined for anything else (other URLs, unsafe names). */
export function readUpload(kind: string, name: string): { data: Buffer; type: string } | undefined {
  if (!isUploadKind(kind) || !NAME.test(name)) return undefined;
  try {
    return { data: fs.readFileSync(path.join(dir(kind), name)), type: TYPES[name.split(".")[1] as Ext] };
  } catch {
    return undefined;
  }
}

/** Delete an upload by its URL; other URLs are ignored. */
export function removeUpload(url: string | null | undefined) {
  const m = /^\/api\/uploads\/([a-z]+)\/([^/]+)$/.exec(url ?? "");
  if (!m || !isUploadKind(m[1]) || !NAME.test(m[2])) return;
  fs.rmSync(path.join(dir(m[1]), m[2]), { force: true });
}

/** The `file` field of a multipart request, checking the declared size first so huge bodies are refused early. */
export async function formFile(req: Request, kind: UploadKind): Promise<Blob> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > UPLOAD_KINDS[kind] + 64 * 1024) throw new Error(`File too large (${Math.round(UPLOAD_KINDS[kind] / 1024 / 1024)} MB max)`);
  const form = await req.formData().catch(() => undefined);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw new Error("Choose an image file");
  return file;
}
