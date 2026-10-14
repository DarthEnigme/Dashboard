import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { db } from "@/lib/db";
import { createNote, deleteNote, getNote, listNotes, notesForService, updateNote } from "@/lib/notes/store";
import { Markdown } from "@/components/settings/Markdown";
import { PERMISSIONS } from "@/lib/config/schema";

beforeEach(() => db().exec("DELETE FROM notes;"));

describe("notes", () => {
  it("are created, searched, edited and linked to services", () => {
    const a = createNote({ title: " Restart the NAS ", body: "1. Stop the VMs\n2. Reboot", services: ["infra.nas", "infra.nas", "bad id!"] }, "root");
    expect(a).toMatchObject({ title: "Restart the NAS", services: ["infra.nas"], updated_by: "root" });
    createNote({ title: "Router", body: "admin password is in the safe" }, "root");
    expect(listNotes("safe").map((n) => n.title)).toEqual(["Router"]);
    expect(listNotes().map((n) => n.title).sort()).toEqual(["Restart the NAS", "Router"]);
    expect(notesForService("infra.nas").map((n) => n.title)).toEqual(["Restart the NAS"]);

    updateNote(a.id, { title: "Restart the NAS", body: "new", services: ["infra.router"] }, "sam");
    expect(getNote(a.id)).toMatchObject({ body: "new", services: ["infra.router"], updated_by: "sam" });
    expect(notesForService("infra.nas")).toEqual([]);
    // Services stay when not given.
    updateNote(a.id, { title: "Restart", body: "x" }, "sam");
    expect(getNote(a.id)?.services).toEqual(["infra.router"]);

    deleteNote(a.id);
    expect(notesForService("infra.router")).toEqual([]);
    expect(() => createNote({ title: " " }, null)).toThrow(/Title required/);
    expect(() => updateNote(999, { title: "x" }, null)).toThrow(/No such note/);
  });

  it("have their own permission", () => {
    expect(PERMISSIONS).toContain("notes");
  });
});

describe("markdown", () => {
  const html = (text: string, rich?: boolean) => renderToStaticMarkup(createElement(Markdown, { text, rich }));

  it("renders runbook blocks", () => {
    const out = html("## Steps\n1. Stop\n2. Start\n\n- [x] done\n- [ ] todo\n\n> careful\n\n---\n```sh\nsudo reboot\n```\n*now* and _later_", true);
    expect(out).toContain("<h3");
    expect(out).toMatch(/<ol[^>]*><li>Stop<\/li><li>Start<\/li><\/ol>/);
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("<blockquote");
    expect(out).toContain("<hr");
    expect(out).toContain("<code>sudo reboot</code>");
    expect(out).toContain("<em>now</em>");
    expect(out).toContain("<em>later</em>");
  });

  it("keeps the short form for small boxes, and stays safe", () => {
    expect(html("# Title")).toMatch(/^<div[^>]*><p class="pt-1 font-semibold/);
    const evil = html('<img src=x onerror=alert(1)> [x](javascript:alert(1)) **b**');
    expect(evil).not.toContain("<img");
    expect(evil).not.toContain('href="javascript');
    expect(evil).toContain("<strong>b</strong>");
    // A star inside a word is not italics.
    expect(html("2*3*4")).not.toContain("<em>");
  });
});
