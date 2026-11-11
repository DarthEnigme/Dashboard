import type { ImportedTrade } from "../import/presets";

/** A broker NanoDash can read trades from: its trades, given the person's key (and account or query id). */
export interface Broker {
  kind: "t212" | "ibkr";
  label: string;
  trades(secret: string, account: string | null): Promise<ImportedTrade[]>;
}
