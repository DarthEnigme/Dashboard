import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { localDay } from "../day";
import { REPEAT_UNITS } from "../tasks/repeat";
import { all, ownTask } from "../tasks/sql";
import { addTask, deleteTask, ensureBoards, loadBoard, tasksSummary, updateTask } from "../tasks/store";
import type { Board, BoardNames, Column, Task, TaskInput } from "../tasks/types";

/**
 * The Tasks app as MCP tools, for one person: Claude (or any MCP client) reads and changes that
 * person's boards through the same store calls the page uses, so the same rules apply (ownership,
 * field limits, "done" columns, repeats, dependencies). Boards, columns and lanes can be named by id
 * or by name, so a client can say "To do" without looking the id up first.
 */
export interface TaskToolsContext {
  /** What a first board and its columns are called, if this person has none yet. */
  names: BoardNames;
  /** settings.tasks.dueSoonDays */
  dueSoonDays: number;
  version?: string;
}

const PRIORITY_NAMES = ["none", "low", "medium", "high"] as const;
/** A cap on the finished tasks listed per "done" column, so a long history doesn't flood the answer. */
const DONE_SHOWN = 15;
const NOTES_SHOWN = 400;

// ---------- input schemas ----------

const ref = z.union([z.number().int(), z.string().min(1)]);
const priority = z.union([z.enum(PRIORITY_NAMES), z.number().int().min(0).max(3)]).describe("none, low, medium or high (or 0–3)");
const due = z.string().nullable().describe("YYYY-MM-DD, or null to clear");
const labels = z.array(z.string()).describe("Replaces the task's labels");
const checklist = z.array(z.union([z.string(), z.object({ text: z.string(), done: z.boolean().optional() })])).describe("Replaces the checklist: items as text, or { text, done }");
const repeat = z.object({ every: z.number().int().min(1).max(365), unit: z.enum(REPEAT_UNITS) }).nullable().describe("Repeat every n days, weeks or months once finished; null to stop");
const service = z.string().nullable().describe("A dashboard service id (group.service) the task is about, or null");
const blockedBy = z.array(z.number().int()).describe("Ids of tasks on the same board this one waits for (replaces the list)");

const taskFields = {
  notes: z.string().optional().describe("Markdown notes (the task's body)"),
  priority: priority.optional(),
  due: due.optional(),
  labels: labels.optional(),
  checklist: checklist.optional(),
  repeat: repeat.optional(),
  service: service.optional(),
  blocked_by: blockedBy.optional(),
};

type Fields = { [K in keyof typeof taskFields]?: z.infer<(typeof taskFields)[K]> } & { title?: string };

/** The tool's fields as the store's TaskInput. */
function storeInput(f: Fields): TaskInput {
  const out: TaskInput = {};
  if (f.title !== undefined) out.title = f.title;
  if (f.notes !== undefined) out.body = f.notes;
  if (f.priority !== undefined) out.priority = typeof f.priority === "number" ? f.priority : PRIORITY_NAMES.indexOf(f.priority);
  if (f.due !== undefined) out.due = f.due;
  if (f.labels !== undefined) out.labels = f.labels;
  if (f.checklist !== undefined) out.checklist = f.checklist.map((c) => (typeof c === "string" ? { text: c, done: false } : c));
  if (f.repeat !== undefined) out.repeat = f.repeat;
  if (f.service !== undefined) out.service = f.service;
  if (f.blocked_by !== undefined) out.blocked_by = f.blocked_by;
  return out;
}

// ---------- what the tools answer ----------

function compactTask(t: Task, board: Board, full = false) {
  const lane = t.lane_id === null ? null : (board.lanes.find((l) => l.id === t.lane_id)?.name ?? null);
  const notes = full || t.body.length <= NOTES_SHOWN ? t.body : `${t.body.slice(0, NOTES_SHOWN)}… (get_task for the rest)`;
  return {
    id: t.id,
    title: t.title,
    ...(full ? { board: { id: board.id, name: board.name }, column: board.columns.find((c) => c.id === t.column_id)?.name } : {}),
    ...(lane ? { lane } : {}),
    ...(t.priority ? { priority: PRIORITY_NAMES[t.priority] } : {}),
    ...(t.due ? { due: t.due } : {}),
    ...(t.labels.length ? { labels: t.labels } : {}),
    ...(notes ? { notes } : {}),
    ...(t.checklist.length ? { checklist: t.checklist } : {}),
    ...(t.repeat ? { repeat: t.repeat } : {}),
    ...(t.service ? { service: t.service } : {}),
    ...(t.blocked_by.length ? { blocked_by: t.blocked_by, blocked: t.blocked } : {}),
    ...(t.completed_at ? { completed: localDay(new Date(t.completed_at)) } : {}),
  };
}

function compactColumn(c: Column, board: Board) {
  const shown = c.done ? c.tasks.slice(-DONE_SHOWN) : c.tasks;
  return {
    id: c.id,
    name: c.name,
    ...(c.done ? { done: true } : {}),
    tasks: shown.map((t) => compactTask(t, board)),
    ...(shown.length < c.tasks.length ? { older_finished_not_shown: c.tasks.length - shown.length } : {}),
  };
}

const answer = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const refuse = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

// ---------- the server ----------

export function tasksServer(userId: number, ctx: TaskToolsContext): McpServer {
  const server = new McpServer(
    { name: "nanodash-tasks", title: "NanoDash tasks", version: ctx.version ?? "1.0.0" },
    {
      instructions:
        "The signed-in person's task boards in NanoDash (kanban: boards → columns → tasks, with optional lanes as rows). " +
        "Start with get_board to see columns and task ids. Boards, columns and lanes can be given by id or by name. " +
        "A task in a column marked done counts as finished; complete_task moves it there. Dates are YYYY-MM-DD in the server's time zone; " +
        "get_board and task_summary give today's date.",
    },
  );

  const board = (id?: number) => loadBoard(userId, id, ctx.names).board;

  /** A board by id or name; the first one when none is given. */
  function findBoard(r?: number | string): Board {
    const boards = ensureBoards(userId, ctx.names);
    if (r === undefined) return board(boards[0].id);
    const hit = boards.find((b) => b.id === Number(r)) ?? boards.find((b) => b.name.toLowerCase() === String(r).trim().toLowerCase());
    if (!hit) throw new Error(`No board "${r}". Boards: ${boards.map((b) => `${b.name} (${b.id})`).join(", ")}`);
    return board(hit.id);
  }

  function findPart<P extends { id: number; name: string }>(parts: P[], r: number | string, what: string): P {
    const hit = parts.find((p) => p.id === Number(r)) ?? parts.find((p) => p.name.toLowerCase() === String(r).trim().toLowerCase());
    if (!hit) throw new Error(`No ${what} "${r}" on this board. ${what[0].toUpperCase()}${what.slice(1)}s: ${parts.map((p) => `${p.name} (${p.id})`).join(", ") || "none"}`);
    return hit;
  }

  /** A column by id (any board) or by name (on `boardRef`, else the first board). */
  function findColumn(r: number | string, boardRef?: number | string): { board: Board; column: Column } {
    if (typeof r === "number" || /^\d+$/.test(r)) {
      const b = ensureBoards(userId, ctx.names)
        .map((s) => board(s.id))
        .find((x) => x.columns.some((c) => c.id === Number(r)));
      if (b) return { board: b, column: b.columns.find((c) => c.id === Number(r))! };
    }
    const b = findBoard(boardRef);
    return { board: b, column: findPart(b.columns, r, "column") };
  }

  function taskAndBoard(id: number): { task: Task; board: Board } {
    const row = ownTask(userId, id);
    const b = board(row.board_id);
    return { task: b.columns.flatMap((c) => c.tasks).find((t) => t.id === id)!, board: b };
  }

  const shown = (id: number) => {
    const { task, board: b } = taskAndBoard(id);
    return compactTask(task, b, true);
  };

  /** Run a store call; its errors (bad input, not yours) come back as the tool's error. */
  const tool = <A>(fn: (args: A) => unknown) => async (args: A): Promise<CallToolResult> => {
    try {
      return answer(await fn(args));
    } catch (e) {
      return refuse((e as Error).message);
    }
  };

  server.registerTool(
    "list_boards",
    { title: "List boards", description: "Your boards, each with its columns and how many open tasks they hold.", annotations: { readOnlyHint: true } },
    tool(() =>
      ensureBoards(userId, ctx.names).map((s) => {
        const b = board(s.id);
        return { id: b.id, name: b.name, columns: b.columns.map((c) => ({ id: c.id, name: c.name, ...(c.done ? { done: true } : { open: c.tasks.length }) })) };
      }),
    ),
  );

  server.registerTool(
    "get_board",
    {
      title: "Get a board",
      description: `A board with its lanes, columns and tasks (ids included). Finished columns list their last ${DONE_SHOWN} tasks.`,
      inputSchema: { board: ref.optional().describe("Board id or name; default: the first board") },
      annotations: { readOnlyHint: true },
    },
    tool(({ board: r }: { board?: number | string }) => {
      const b = findBoard(r);
      return {
        today: localDay(),
        board: { id: b.id, name: b.name, ...(b.project ? { project: true } : {}) },
        ...(b.lanes.length ? { lanes: b.lanes.map((l) => ({ id: l.id, name: l.name })) } : {}),
        columns: b.columns.map((c) => compactColumn(c, b)),
      };
    }),
  );

  server.registerTool(
    "get_task",
    { title: "Get a task", description: "One task in full: notes, checklist, where it is.", inputSchema: { id: z.number().int() }, annotations: { readOnlyHint: true } },
    tool(({ id }: { id: number }) => shown(id)),
  );

  server.registerTool(
    "search_tasks",
    {
      title: "Search tasks",
      description: "Find tasks on all your boards whose title, notes or labels contain the text.",
      inputSchema: { query: z.string().min(1), include_finished: z.boolean().optional().describe("Default false") },
      annotations: { readOnlyHint: true },
    },
    tool(({ query, include_finished }: { query: string; include_finished?: boolean }) => {
      const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = all<{ id: number; title: string; board: string; column: string; due: string | null; completed_at: number | null }>(
        `SELECT t.id, t.title, b.name AS board, c.name AS column, t.due, t.completed_at FROM tasks t
         JOIN task_columns c ON c.id = t.column_id JOIN task_boards b ON b.id = c.board_id
         WHERE b.owner_id = ? AND (t.title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\' OR t.labels LIKE ? ESCAPE '\\') ${include_finished ? "" : "AND t.completed_at IS NULL"}
         ORDER BY t.completed_at IS NOT NULL, t.due IS NULL, t.due, t.id LIMIT 50`,
        userId,
        like,
        like,
        like,
      );
      return rows.map(({ completed_at, due: d, ...t }) => ({ ...t, ...(d ? { due: d } : {}), ...(completed_at ? { finished: true } : {}) }));
    }),
  );

  server.registerTool(
    "add_task",
    {
      title: "Add a task",
      description: "Add a task at the bottom of a column. Returns the new task.",
      inputSchema: {
        title: z.string().min(1),
        column: ref.describe("Column id or name, e.g. \"To do\""),
        board: ref.optional().describe("Board id or name, when the column is given by name; default: the first board"),
        lane: ref.nullable().optional().describe("Lane id or name"),
        ...taskFields,
      },
    },
    tool(({ title, column, board: boardRef, lane, ...f }: Fields & { title: string; column: number | string; board?: number | string; lane?: number | string | null }) => {
      const { board: b, column: c } = findColumn(column, boardRef);
      const input: TaskInput = { ...storeInput({ title, ...f }), column: c.id };
      if (lane !== undefined) input.lane = lane === null ? null : findPart(b.lanes, lane, "lane").id;
      const before = new Set(b.columns.flatMap((x) => x.tasks.map((t) => t.id)));
      addTask(userId, input);
      const added = board(b.id).columns.flatMap((x) => x.tasks).find((t) => !before.has(t.id));
      return added ? shown(added.id) : board(b.id);
    }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Change a task",
      description: "Change a task's fields; only the ones given change. To move it, use move_task.",
      inputSchema: { id: z.number().int(), title: z.string().min(1).optional(), ...taskFields },
    },
    tool(({ id, ...f }: Fields & { id: number }) => {
      updateTask(userId, { ...storeInput(f), id });
      return shown(id);
    }),
  );

  server.registerTool(
    "move_task",
    {
      title: "Move a task",
      description: "Move a task to another column (and/or lane) of its board. Moving it into a finished column completes it.",
      inputSchema: {
        id: z.number().int(),
        column: ref.optional().describe("Column id or name on the task's board"),
        lane: ref.nullable().optional().describe("Lane id or name, or null for no lane"),
        index: z.number().int().min(0).optional().describe("Position in the cell, 0 = top; default: the bottom"),
      },
    },
    tool(({ id, column, lane, index }: { id: number; column?: number | string; lane?: number | string | null; index?: number }) => {
      const { board: b } = taskAndBoard(id);
      const input: TaskInput = { id };
      if (column !== undefined) input.column = findPart(b.columns, column, "column").id;
      if (lane !== undefined) input.lane = lane === null ? null : findPart(b.lanes, lane, "lane").id;
      if (index !== undefined) input.index = index;
      updateTask(userId, input);
      return shown(id);
    }),
  );

  server.registerTool(
    "complete_task",
    { title: "Complete a task", description: "Move a task into its board's first finished column.", inputSchema: { id: z.number().int() } },
    tool(({ id }: { id: number }) => {
      const { task, board: b } = taskAndBoard(id);
      const done = b.columns.find((c) => c.done);
      if (!done) throw new Error("This board has no column for finished tasks");
      if (task.column_id !== done.id) updateTask(userId, { id, column: done.id });
      return shown(id);
    }),
  );

  server.registerTool(
    "delete_task",
    { title: "Delete a task", description: "Delete a task for good.", inputSchema: { id: z.number().int() }, annotations: { destructiveHint: true } },
    tool(({ id }: { id: number }) => {
      const { title } = taskAndBoard(id).task;
      deleteTask(userId, id);
      return { deleted: { id, title } };
    }),
  );

  server.registerTool(
    "task_summary",
    { title: "Task summary", description: "Open and overdue counts, and the tasks due soon or late across all your boards.", annotations: { readOnlyHint: true } },
    tool(() => ({ today: localDay(), ...tasksSummary(userId, ctx.dueSoonDays) })),
  );

  return server;
}
