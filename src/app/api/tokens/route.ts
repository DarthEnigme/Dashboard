import { NextResponse } from "next/server";
import { requirePermission, requireUser, sameOrigin } from "@/lib/auth";
import { audit } from "@/lib/auth/users";
import { createToken, isScope, listTokens, revokeToken } from "@/lib/auth/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Admins see every token; everyone else, and anyone asking with ?mine=1, sees only their own.
 * Signed out: 401.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return json("Sign in first", 401);
  const mine = user.role !== "admin" || new URL(req.url).searchParams.has("mine");
  return NextResponse.json(listTokens(mine ? user.id : undefined));
}

/**
 * { name, scope? }: answers { token, list }; the token is shown this once. A `metrics` token (the
 * default) needs an admin, a `tasks` token the `tasks` permission. `list` is what GET would answer.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json("Cross-site request refused", 403);
  const { name, scope = "metrics" } = ((await req.json().catch(() => ({}))) ?? {}) as { name?: string; scope?: unknown };
  if (!isScope(scope)) return json("Unknown token scope", 400);
  const user = scope === "tasks" ? await requirePermission("tasks") : await requireUser();
  if (!user || (scope === "metrics" && user.role !== "admin")) return json(scope === "metrics" ? "Admins only" : "You don't have access to the task boards", 403);
  try {
    const { token } = createToken(user.id, String(name ?? ""), scope);
    audit(user.username, "token-create", { name, scope });
    return NextResponse.json({ token, list: listTokens(user.role === "admin" && scope === "metrics" ? undefined : user.id) }, { status: 201 });
  } catch (e) {
    return json((e as Error).message, 400);
  }
}

/** ?id=: admins can revoke any token, everyone else only their own. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (!user) return json("Sign in first", 401);
  if (!sameOrigin(req)) return json("Cross-site request refused", 403);
  const params = new URL(req.url).searchParams;
  const id = Number(params.get("id"));
  const mine = user.role !== "admin" || params.has("mine");
  audit(user.username, "token-revoke", { id });
  if (user.role === "admin") revokeToken(id);
  else revokeToken(id, user.id);
  return NextResponse.json(listTokens(mine ? user.id : undefined));
}
