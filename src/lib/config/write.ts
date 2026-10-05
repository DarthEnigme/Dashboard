import fs from "node:fs";
import YAML, { Document, isMap, isScalar, isSeq, type Node } from "yaml";
import { configFiles, MASK, type ConfigFile } from "./schema";
import { filePath, readRaw, invalidate } from "./load";

const ORIG = "_orig";

/** Key used to match a new sequence item with an old node: the item's original name, else its name. */
function itemKey(v: unknown): string | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const k = o[ORIG] ?? o.name;
    return typeof k === "string" ? k : undefined;
  }
  return undefined;
}

function nodeName(n: unknown): string | undefined {
  if (isMap(n)) {
    const v = n.get("name");
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

/**
 * Build a node for `value`, reusing `old` where possible so that comments and formatting survive.
 * A string equal to MASK keeps the old value (secrets the editor never saw).
 */
function merge(doc: Document, old: unknown, value: unknown): Node | undefined {
  if (value === MASK) return isScalar(old) ? old : undefined;

  if (Array.isArray(value)) {
    const oldItems = isSeq(old) ? [...old.items] : [];
    const byName = new Map<string, unknown>();
    oldItems.forEach((n) => {
      const k = nodeName(n);
      if (k !== undefined && !byName.has(k)) byName.set(k, n);
    });
    // Each old node may be reused once: named items claim theirs first, nameless items
    // (e.g. info widgets) fall back to the node at the same position if it is still free.
    const used = new Set<unknown>();
    const matches = value.map((v) => {
      const k = itemKey(v);
      const m = k !== undefined ? byName.get(k) : undefined;
      if (m) {
        byName.delete(k!);
        used.add(m);
      }
      return m;
    });
    value.forEach((v, i) => {
      if (matches[i] || itemKey(v) !== undefined) return;
      const m = oldItems[i];
      if (m !== undefined && !used.has(m)) {
        matches[i] = m;
        used.add(m);
      }
    });
    const seq = isSeq(old) ? old : doc.createNode([]);
    seq.items = value.map((v, i) => merge(doc, matches[i], v) ?? doc.createNode(null));
    return seq;
  }

  if (value && typeof value === "object") {
    const map = isMap(old) ? old : doc.createNode({});
    const entries = Object.entries(value).filter(([k]) => !k.startsWith("_"));
    const keep = new Set(entries.map(([k]) => k));
    for (const pair of [...map.items]) {
      const k = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (!keep.has(k)) map.delete(k);
    }
    for (const [k, v] of entries) {
      if (v === undefined || v === "") {
        map.delete(k);
        continue;
      }
      const prev = map.get(k, true);
      const node = merge(doc, prev, v);
      if (node === undefined) map.delete(k);
      else if (node !== prev) map.set(k, node);
    }
    return map;
  }

  if (isScalar(old)) {
    if (old.value === value) return old;
    const n = doc.createNode(value);
    n.comment = old.comment;
    n.commentBefore = old.commentBefore;
    return n;
  }
  return doc.createNode(value);
}

/** Patch YAML text with new data, keeping comments on unchanged parts. Pure; used by tests. */
export function patchYaml(text: string, data: unknown): string {
  const doc = YAML.parseDocument(text);
  const contents = merge(doc, doc.contents, data);
  doc.contents = (contents ?? doc.createNode(null)) as typeof doc.contents;
  // An item moved to the top keeps its blank-line separator; drop it so the file doesn't start empty.
  const first = isSeq(doc.contents) ? doc.contents.items[0] : undefined;
  if (first && typeof first === "object" && "spaceBefore" in first) first.spaceBefore = false;
  return doc.toString({ lineWidth: 0 });
}

export function writeConfig(file: ConfigFile, data: unknown): { ok: true } | { ok: false; error: string } {
  readRaw(file); // ensures defaults exist
  const p = filePath(file);
  const text = fs.readFileSync(p, "utf8");
  const out = patchYaml(text, data);
  // Validate the merged result so masked secrets resolve to their stored values.
  const parsed = configFiles[file].safeParse(YAML.parse(out) ?? undefined);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out, "utf8");
  fs.renameSync(tmp, p);
  invalidate();
  return { ok: true };
}
