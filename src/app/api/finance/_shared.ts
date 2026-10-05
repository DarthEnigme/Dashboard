import { NextResponse } from "next/server";
import { requireUser, sameOrigin } from "@/lib/auth";

export const unauthorized = () => NextResponse.json({ error: "Sign in to use finance" }, { status: 401 });
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Finance is personal: every route needs a signed-in user; changes must also be same-origin. */
export async function guard(req?: Request) {
  const user = await requireUser();
  if (!user) return { error: unauthorized() };
  if (req && req.method !== "GET" && !sameOrigin(req)) return { error: bad("Cross-site request refused", 403) };
  return { user };
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
