import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";
import type { Permission } from "@/lib/config/schema";

/** What every app's API routes start with. */
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** The JSON object a request carries ({} when it carries none, or something else). */
export const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

/** An app's guard: a signed-in person with `permission`; changes must also be same-origin. `what` names the app in refusals. */
export const guardFor = (permission: Permission, what?: string) => (req?: Request) => guardPermission(permission, req, what);

/** Run a store call that throws on bad input, and answer 400 with its message when it does. */
export async function attempt(fn: () => unknown, status = 200) {
  try {
    return NextResponse.json(await fn(), { status });
  } catch (e) {
    return bad((e as Error).message);
  }
}

type Guard = (req?: Request) => Promise<{ user: { id: number } } | { error: Response }>;
type StoreCall<A, R> = (userId: number, arg: A) => R | Promise<R>;

/**
 * The POST, PATCH and DELETE handlers of an app's records. POST (201) and PATCH pass the JSON body
 * and DELETE passes `?id=` to a store call that throws on bad input (answered 400 with its
 * message); `answer` turns what the call returned into the reply's body.
 */
export function crudRoutes<R>(
  guard: Guard,
  store: { create: StoreCall<Record<string, unknown>, R>; update: StoreCall<Record<string, unknown>, R>; remove: StoreCall<number, R> },
  answer: (userId: number, result: R) => unknown | Promise<unknown>,
) {
  const handle = (status: number, call: (userId: number, req: Request) => Promise<R>) => async (req: Request) => {
    const g = await guard(req);
    if ("error" in g) return g.error;
    let result: R;
    try {
      result = await call(g.user.id, req);
    } catch (e) {
      return bad((e as Error).message);
    }
    return NextResponse.json(await answer(g.user.id, result), { status });
  };
  return {
    POST: handle(201, async (u, req) => store.create(u, await body(req))),
    PATCH: handle(200, async (u, req) => store.update(u, await body(req))),
    DELETE: handle(200, async (u, req) => store.remove(u, Number(new URL(req.url).searchParams.get("id")))),
  };
}
