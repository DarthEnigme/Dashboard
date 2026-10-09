import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/load";
import { createAccount, deleteAccount, listAccounts, seedAccounts, updateAccount, withBalances } from "@/lib/finance/accounts";
import { ratesForSummary } from "@/lib/finance/rates";
import { bad, guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Every account with its balance and 12-month history (accounts named on transactions are added first). */
async function list() {
  seedAccounts(loadConfig().settings.finance.currency);
  const accounts = listAccounts();
  const rates = new Map<string, Record<string, number> | undefined>();
  for (const c of new Set(accounts.map((a) => a.currency))) rates.set(c, (await ratesForSummary(c))?.rates);
  return withBalances(accounts, (c) => rates.get(c));
}

const cents = (v: unknown) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("Opening balance must be a number");
  return Math.round(n * 100);
};
const currencyOf = (v: unknown) => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : undefined);

export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(await list());
}

/** { name, kind?, currency?, opening? } */
export async function POST(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  try {
    createAccount({ name: b.name, kind: b.kind, currency: currencyOf(b.currency) ?? loadConfig().settings.finance.currency, openingCents: cents(b.opening) });
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json(await list(), { status: 201 });
}

/** { id, name?, kind?, currency?, opening?, archived? } */
export async function PATCH(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  try {
    updateAccount(Number(b.id), {
      name: b.name,
      kind: b.kind,
      currency: currencyOf(b.currency),
      openingCents: cents(b.opening),
      archived: typeof b.archived === "boolean" ? b.archived : undefined,
    });
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json(await list());
}

/** ?id= deletes an account without transactions. */
export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("error" in g) return g.error;
  try {
    deleteAccount(Number(new URL(req.url).searchParams.get("id")));
  } catch (e) {
    return bad((e as Error).message);
  }
  return NextResponse.json(await list());
}
