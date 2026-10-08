import { db } from "../db";

/**
 * Savings goals: a target and what has been put aside for it. Money set aside is a move between
 * your own pots, not spending, so it stays out of transactions and the income/spending totals.
 */
export interface Goal {
  id: number;
  name: string;
  target: number; // cents
  currency: string;
  deadline: string | null;
  saved: number; // cents
  /** Still needed per month to make the deadline (null without one, or once reached). */
  perMonth: number | null;
  moves: { id: number; date: string; amount: number; note: string | null }[];
}

export function listGoals(): Goal[] {
  const goals = db()
    .prepare(
      `SELECT g.id, g.name, g.target_cents AS target, g.currency, g.deadline,
              COALESCE((SELECT SUM(amount_cents) FROM fin_goal_moves m WHERE m.goal_id = g.id), 0) AS saved
       FROM fin_goals g ORDER BY g.deadline IS NULL, g.deadline, g.name`,
    )
    .all() as unknown as Omit<Goal, "moves" | "perMonth">[];
  const moves = db().prepare("SELECT id, goal_id, date, amount_cents AS amount, note FROM fin_goal_moves ORDER BY date DESC, id DESC").all() as unknown as (Goal["moves"][number] & {
    goal_id: number;
  })[];
  const today = new Date().toISOString().slice(0, 10);
  return goals.map((g) => ({ ...g, perMonth: monthlyNeeded(g, today), moves: moves.filter((m) => m.goal_id === g.id).slice(0, 10).map(({ goal_id: _, ...m }) => m) }));
}

export function createGoal(g: { name: string; target: number; currency: string; deadline: string | null }) {
  db().prepare("INSERT INTO fin_goals (name, target_cents, currency, deadline, created_at) VALUES (?, ?, ?, ?, ?)").run(g.name, g.target, g.currency.toUpperCase(), g.deadline, Date.now());
}

export function updateGoal(id: number, patch: { name?: string; target?: number; deadline?: string | null }) {
  const cols = Object.entries({ name: patch.name, target_cents: patch.target, deadline: patch.deadline }).filter(([, v]) => v !== undefined);
  if (!cols.length) return;
  db()
    .prepare(`UPDATE fin_goals SET ${cols.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...cols.map(([, v]) => v as string | number | null), id);
}

export const deleteGoal = (id: number) => db().prepare("DELETE FROM fin_goals WHERE id = ?").run(id);

/** Put money aside (positive) or take it back out (negative). */
export function moveToGoal(id: number, cents: number, date: string, note: string | null) {
  if (!Number.isInteger(cents) || cents === 0) throw new Error("Amount must be a non-zero number");
  const res = db().prepare("INSERT INTO fin_goal_moves (goal_id, date, amount_cents, note, created_at) SELECT id, ?, ?, ?, ? FROM fin_goals WHERE id = ?").run(date, cents, note, Date.now(), id);
  if (!res.changes) throw new Error("No such goal");
}

export const deleteGoalMove = (id: number) => db().prepare("DELETE FROM fin_goal_moves WHERE id = ?").run(id);

/** Per month still needed to reach the target by the deadline (null without a deadline or once reached). */
export function monthlyNeeded(g: Pick<Goal, "target" | "saved" | "deadline">, today: string): number | null {
  const left = g.target - g.saved;
  if (!g.deadline || left <= 0) return null;
  const [y, m] = today.split("-").map(Number);
  const [dy, dm] = g.deadline.split("-").map(Number);
  const months = Math.max(1, (dy - y) * 12 + (dm - m) + 1);
  return Math.ceil(left / months);
}
