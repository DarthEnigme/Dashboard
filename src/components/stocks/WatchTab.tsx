"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, sendJson } from "@/lib/fetcher";
import type { WatchQuote } from "@/lib/stocks/types";
import { useT } from "@/i18n/client";
import { DeleteButton } from "../edit/controls";
import { percent, quoted, stockHref, tone } from "./format";
import { Spark } from "./parts";
import { SymbolSearch } from "./SymbolSearch";
import { SymbolIcon } from "./SymbolIcon";

const WATCH_URL = "/api/stocks/watch";

/** Symbols to keep an eye on, without owning them. */
export function WatchTab() {
  const t = useT();
  const { data, mutate, error } = useSWR<WatchQuote[]>(WATCH_URL, fetcher);
  const [failure, setFailure] = useState<string>();
  const change = async (work: Promise<unknown>) => {
    setFailure(undefined);
    await work.catch((e: Error) => setFailure(e.message));
    await mutate();
  };
  const problem = failure ?? (error as Error | undefined)?.message;
  return (
    <>
      <div className="max-w-md">
        <SymbolSearch placeholder={t("Add a share, fund or index to watch")} onPick={(hit) => void change(sendJson(WATCH_URL, "POST", { symbol: hit.symbol }))} />
      </div>
      {problem && <p role="alert" className="text-sm text-[var(--err)]">{problem}</p>}
      {data?.length === 0 && <p className="glass rounded-3xl p-8 text-center text-muted">{t("Nothing watched yet.")}</p>}
      {data && data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((q) => (
            <li key={q.symbol} className="glass flex items-center gap-3 rounded-3xl p-4">
              <SymbolIcon symbol={q.symbol} size={36} />
              <Link href={stockHref(q.symbol)} className="group flex min-w-0 flex-1 flex-col">
                <span className="font-semibold group-hover:text-accent">{q.symbol}</span>
                <span className="truncate text-xs text-muted">{q.name}</span>
              </Link>
              <Spark values={q.closes} />
              <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                {q.price === null ? <span className="text-muted">{t("no price")}</span> : quoted(q.price, q.currency)}
                <div className={`text-xs ${tone(q.change)}`}>{percent(q.change)}</div>
              </div>
              <DeleteButton label={t("Stop watching {symbol}", { symbol: q.symbol })} onConfirm={() => void change(sendJson(`${WATCH_URL}?symbol=${encodeURIComponent(q.symbol)}`, "DELETE"))} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
