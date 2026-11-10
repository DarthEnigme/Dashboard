import { guard, reply } from "./_shared";

export const dynamic = "force-dynamic";

/** Your boards, and one of them in full (?board=<id>, else the first): columns, tasks and the labels in use. */
export async function GET(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const board = Number(new URL(req.url).searchParams.get("board")) || undefined;
  return reply(g.user.id, board);
}
