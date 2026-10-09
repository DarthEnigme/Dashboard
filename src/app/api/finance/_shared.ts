import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Finance is personal: every route needs a signed-in user with the finance permission; changes must also be same-origin. */
export const guard = (req?: Request) => guardPermission("finance", req);

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
