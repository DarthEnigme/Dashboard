import { msg } from "@/i18n";
import type { ImportedTrade } from "../import/presets";

/**
 * The brokers NanoDash can read trades from, described once: what the connect dialog asks for and
 * says, and what a connection must carry. Pure, so the page reads it too; each broker's client is
 * in its own file.
 */
export const BROKER_INFO = {
  t212: {
    label: "Trading 212",
    secretLabel: msg("API key (or key:secret)"),
    secretMissing: "The API key is required",
    /** A second field the connection needs (null: none). */
    account: null,
    help: msg("In Trading 212: Settings → API (Beta) → generate a key with permission to read history. Read-only is enough."),
  },
  ibkr: {
    label: "Interactive Brokers",
    secretLabel: msg("Flex Web Service token"),
    secretMissing: "The Flex token is required",
    account: { label: msg("Flex query id"), placeholder: "123456", missing: "The Flex query id is required" },
    help: msg("In the IBKR Client Portal: Performance & Reports → Flex Queries → a Trade Confirmation or Activity query with Trades, then Flex Web Service → token."),
  },
} as const;

export type BrokerKind = keyof typeof BROKER_INFO;
export const BROKER_KINDS = Object.keys(BROKER_INFO) as BrokerKind[];

/** A broker's client: its trades, given the person's key (and account or query id). */
export interface Broker {
  kind: BrokerKind;
  trades(secret: string, account: string | null): Promise<ImportedTrade[]>;
}
