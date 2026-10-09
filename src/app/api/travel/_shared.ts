import { NextResponse } from "next/server";
import { guardPermission } from "@/lib/auth";

export const guard = (req?: Request) => guardPermission("travel", req, "the travel log");
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
export const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
