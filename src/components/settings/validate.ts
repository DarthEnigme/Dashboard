import { settingsSchema } from "@/lib/config/schema";
import { getPath } from "../edit/FieldsDialog";
import { sections } from "./sections";

type Obj = Record<string, unknown>;

// Same pattern as isPlaceholder in lib/config/env.ts (which also reads files, so isn't client-safe).
const placeholder = /^\{\{\s*HOMEPAGE_(VAR|FILE)_[A-Z0-9_]+\s*\}\}$/;

export const fieldKeys = sections.flatMap((s) => [...s.fields.map((f) => f.key), ...(s.extraKeys ?? [])]);

/** The field a schema issue belongs to: the longest field key that prefixes the issue path. */
function fieldFor(path: (string | number)[]): string {
  const p = path.join(".");
  return fieldKeys.filter((k) => p === k || p.startsWith(`${k}.`)).sort((a, b) => b.length - a.length)[0] ?? (p || "(settings)");
}

/**
 * Validate the draft as the server will (minus env substitution: values that are
 * {{HOMEPAGE_VAR_…}} placeholders are only known on the server, so they pass here).
 */
export function validateSettings(draft: Obj): { errors: Record<string, string>; parsed?: ReturnType<typeof settingsSchema.parse> } {
  const r = settingsSchema.safeParse(draft);
  if (r.success) return { errors: {}, parsed: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const value = getPath(draft, issue.path.join("."));
    if (typeof value === "string" && placeholder.test(value.trim())) continue;
    const key = fieldFor(issue.path);
    errors[key] ??= key === issue.path.join(".") ? issue.message : `${issue.path.slice(key.split(".").length).join(".")}: ${issue.message}`;
  }
  return { errors };
}

/** Fields whose value differs between two settings objects. */
export function changedFields(a: Obj, b: Obj): string[] {
  return fieldKeys.filter((k) => JSON.stringify(getPath(a, k) ?? null) !== JSON.stringify(getPath(b, k) ?? null));
}
