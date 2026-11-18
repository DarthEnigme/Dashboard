import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { CONFIG_DIR, invalidate } from "@/lib/config/load";
import { createToken, listTokens, revokeToken, verifyToken } from "@/lib/auth/tokens";
import { tasksServer } from "@/lib/mcp/tasks-tools";
import { loadBoard, type BoardNames } from "@/lib/tasks/store";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const NAMES: BoardNames = { board: "My board", columns: ["To do", "In progress", "Done"] };
const user = (name: string, role = "user") => Number(db().prepare("INSERT INTO users (username, role, created_at) VALUES (?, ?, ?)").run(name, role, Date.now()).lastInsertRowid);
const settings = path.join(CONFIG_DIR, "settings.yaml");

/** Every app on, and every signed-in user allowed the task boards (unless `perms` says otherwise). */
function setPermissions(perms = "[tasks]") {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(settings, `title: Test\nauth:\n  userPermissions: ${perms}\n`);
  invalidate();
}

beforeAll(() => setPermissions());
afterAll(() => {
  fs.rmSync(settings, { force: true });
  invalidate();
});

let me = 0;
let other = 0;
beforeEach(() => {
  db().exec("DELETE FROM task_boards; DELETE FROM api_tokens; DELETE FROM users;");
  setPermissions();
  me = user("me");
  other = user("other");
});

describe("token scopes", () => {
  it("keeps metrics tokens for admins and tasks tokens for the task boards", () => {
    const admin = user("root", "admin");
    const metrics = createToken(admin, "Prometheus").token;
    const tasks = createToken(me, "Claude", "tasks").token;
    expect(verifyToken(`Bearer ${metrics}`, "metrics")).toMatchObject({ username: "root" });
    expect(verifyToken(`Bearer ${metrics}`, "tasks")).toBeUndefined();
    // A plain user can hold and use a tasks token, but it never reads the metrics.
    expect(verifyToken(`Bearer ${tasks}`, "tasks")).toMatchObject({ userId: me, username: "me" });
    expect(verifyToken(`Bearer ${tasks}`, "metrics")).toBeUndefined();
    // Not even when its owner is an admin.
    const adminTasks = createToken(admin, "Claude", "tasks").token;
    expect(verifyToken(`Bearer ${adminTasks}`, "metrics")).toBeUndefined();
  });

  it("stops a tasks token when its owner loses the permission or is disabled", () => {
    const tasks = createToken(me, "Claude", "tasks").token;
    setPermissions("[finance]");
    expect(verifyToken(`Bearer ${tasks}`, "tasks")).toBeUndefined();
    setPermissions();
    db().prepare("UPDATE users SET disabled = 1 WHERE id = ?").run(me);
    expect(verifyToken(`Bearer ${tasks}`, "tasks")).toBeUndefined();
  });

  it("lists and revokes one person's tokens only", () => {
    createToken(me, "Mine", "tasks");
    createToken(other, "Theirs", "tasks");
    const [mine] = listTokens(me);
    expect(listTokens(me).map((t) => [t.name, t.scope])).toEqual([["Mine", "tasks"]]);
    expect(listTokens()).toHaveLength(2);
    // Someone else's id does nothing.
    revokeToken(listTokens(other)[0].id, me);
    expect(listTokens()).toHaveLength(2);
    expect(revokeToken(mine.id, me)).toEqual([]);
  });

  it("refuses an unknown scope", () => {
    expect(() => createToken(me, "x", "admin" as never)).toThrow(/scope/);
  });
});

/** A client talking to `userId`'s task server in memory, as Claude would over HTTP. */
async function connect(userId: number) {
  const server = tasksServer(userId, { names: NAMES, dueSoonDays: 1 });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const text = (r.content[0] as { text: string }).text;
    if (r.isError) throw new Error(text);
    return JSON.parse(text);
  };
  return { client, call };
}

describe("MCP task tools", () => {
  it("lists the tools", async () => {
    const { client } = await connect(me);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["add_task", "complete_task", "delete_task", "get_board", "get_task", "list_boards", "move_task", "search_tasks", "task_summary", "update_task"]);
  });

  it("adds, changes, moves, completes and deletes a task by column name", async () => {
    const { call } = await connect(me);
    const first = await call("get_board");
    expect(first.columns.map((c: { name: string }) => c.name)).toEqual(["To do", "In progress", "Done"]);
    expect(first.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const added = await call("add_task", { title: "Renew cert", column: "to do", due: "2026-12-01", priority: "high", labels: ["infra"], checklist: ["Order", { text: "Install", done: false }] });
    expect(added).toMatchObject({ title: "Renew cert", column: "To do", due: "2026-12-01", priority: "high", labels: ["infra"], checklist: [{ text: "Order", done: false }, { text: "Install", done: false }] });

    const changed = await call("update_task", { id: added.id, notes: "On **pve**", priority: 0, due: null });
    expect(changed).toMatchObject({ notes: "On **pve**" });
    expect(changed.priority).toBeUndefined();
    expect(changed.due).toBeUndefined();

    expect(await call("move_task", { id: added.id, column: "In progress" })).toMatchObject({ column: "In progress" });
    const done = await call("complete_task", { id: added.id });
    expect(done).toMatchObject({ column: "Done" });
    expect(done.completed).toMatch(/^\d{4}-/);
    expect(await call("search_tasks", { query: "cert" })).toEqual([]);
    expect(await call("search_tasks", { query: "cert", include_finished: true })).toMatchObject([{ id: added.id, finished: true }]);

    // It is the same board the page shows.
    expect(loadBoard(me, undefined, NAMES).board.columns[2].tasks.map((t) => t.title)).toEqual(["Renew cert"]);

    expect(await call("delete_task", { id: added.id })).toEqual({ deleted: { id: added.id, title: "Renew cert" } });
    expect((await call("task_summary")).open).toBe(0);
  });

  it("answers bad input with the store's own message", async () => {
    const { call } = await connect(me);
    await expect(call("add_task", { title: "x", column: "Nowhere" })).rejects.toThrow(/No column "Nowhere".*To do/);
    const t = await call("add_task", { title: "x", column: "To do" });
    await expect(call("update_task", { id: t.id, due: "tomorrow" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(call("get_board", { board: "Other" })).rejects.toThrow(/No board/);
  });

  it("never reaches someone else's boards", async () => {
    const mine = await connect(me);
    const theirs = await connect(other);
    const t = await mine.call("add_task", { title: "Private", column: "To do" });
    const { columns } = await mine.call("get_board");
    await expect(theirs.call("get_task", { id: t.id })).rejects.toThrow(/No such task/);
    await expect(theirs.call("update_task", { id: t.id, title: "Mine now" })).rejects.toThrow(/No such task/);
    await expect(theirs.call("move_task", { id: t.id, column: "Done" })).rejects.toThrow(/No such task/);
    await expect(theirs.call("delete_task", { id: t.id })).rejects.toThrow(/No such task/);
    // A column id of mine doesn't put their task on my board.
    await expect(theirs.call("add_task", { title: "Sneaky", column: columns[0].id })).rejects.toThrow(/No such column|No column/);
    expect(await theirs.call("search_tasks", { query: "Private" })).toEqual([]);
    expect((await mine.call("get_task", { id: t.id })).title).toBe("Private");
  });
});

describe("POST /api/mcp", () => {
  const rpc = (body: unknown, token?: string) =>
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

  it("asks for a token, then serves the owner's boards", async () => {
    const { POST, GET } = await import("@/app/api/mcp/route");
    const refused = await POST(rpc(init));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toMatch(/^Bearer/);
    const metrics = createToken(user("root", "admin"), "Prometheus").token;
    expect((await POST(rpc(init, metrics))).status).toBe(401);

    const token = createToken(me, "Claude", "tasks").token;
    const ok = await POST(rpc(init, token));
    expect(ok.status).toBe(200);
    expect((await ok.json()).result.serverInfo.name).toBe("nanodash-tasks");

    const call = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add_task", arguments: { title: "Over HTTP", column: "To do" } } }, token));
    const out = await call.json();
    expect(JSON.parse(out.result.content[0].text)).toMatchObject({ title: "Over HTTP", column: "To do" });
    expect(listTokens(me)[0].last_used).not.toBeNull();
    expect((await GET(new Request("http://localhost/api/mcp", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(405);
  });
});
