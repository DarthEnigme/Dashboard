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
