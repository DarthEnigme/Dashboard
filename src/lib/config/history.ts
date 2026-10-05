import fs from "node:fs";
import { diffLines } from "diff";
import { db } from "../db";
import { filePath, invalidate } from "./load";
import type { ConfigFile } from "./schema";

const KEEP = 200;

export interface Version {
  id: number;
  file: string;
  ts: number;
  /** Who made the change that followed this snapshot. */
  user: string | null;
  size: number;
}

const read = (file: ConfigFile) => {
  try {
    return fs.readFileSync(filePath(file), "utf8");
  } catch {
    return "";
  }
};

/**
 * Snapshot a file as it is right before a change (so hand edits are captured too).
 * Skipped when nothing changed since the last snapshot.
 */
export function saveVersionBefore(file: ConfigFile, user: string | null) {
  try {
    const content = read(file);
    const last = db().prepare("SELECT content FROM config_versions WHERE file = ? ORDER BY id DESC LIMIT 1").get(file) as
      | { content: string }
      | undefined;
    if (last?.content === content) return;
    db().prepare("INSERT INTO config_versions (file, ts, user, content) VALUES (?, ?, ?, ?)").run(file, Date.now(), user, content);
    db()
      .prepare("DELETE FROM config_versions WHERE file = ? AND id NOT IN (SELECT id FROM config_versions WHERE file = ? ORDER BY id DESC LIMIT ?)")
      .run(file, file, KEEP);
  } catch (e) {
    // History is a convenience; never block a save because of it.
    console.warn("[page] could not snapshot config:", e);
  }
}

export function listVersions(file?: ConfigFile): Version[] {
  const sql = `SELECT id, file, ts, user, length(content) AS size FROM config_versions ${file ? "WHERE file = ?" : ""} ORDER BY id DESC LIMIT 300`;
  return db().prepare(sql).all(...(file ? [file] : [])) as unknown as Version[];
}

export function getVersion(id: number): (Version & { content: string }) | undefined {
  return db().prepare("SELECT id, file, ts, user, length(content) AS size, content FROM config_versions WHERE id = ?").get(id) as
    | (Version & { content: string })
    | undefined;
}

export interface DiffPart {
  kind: "add" | "remove" | "same";
  text: string;
}

/** Line diff from `from` to `to`, with long unchanged runs collapsed. */
export function lineDiff(from: string, to: string, context = 3): DiffPart[] {
  const out: DiffPart[] = [];
  for (const part of diffLines(from, to)) {
    const kind = part.added ? "add" : part.removed ? "remove" : "same";
    let text = part.value;
    if (kind === "same") {
      const lines = text.replace(/\n$/, "").split("\n");
      if (lines.length > context * 2 + 1) {
        text = [...lines.slice(0, context), `… ${lines.length - context * 2} unchanged lines …`, ...lines.slice(-context)].join("\n") + "\n";
      }
    }
    out.push({ kind, text });
  }
  return out;
}

/** Diff of a snapshot against the current file (what restoring it would change). */
export const diffWithCurrent = (v: { file: string; content: string }) => lineDiff(read(v.file as ConfigFile), v.content);

/** Write a snapshot back. The current content is snapshotted first, so a restore can itself be undone. */
export function restoreVersion(id: number, user: string | null): Version | undefined {
  const v = getVersion(id);
  if (!v) return undefined;
  const file = v.file as ConfigFile;
  saveVersionBefore(file, user);
  const p = filePath(file);
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, v.content, "utf8");
  fs.renameSync(tmp, p);
  invalidate();
  return v;
}
