/** The Stocks page's sections, known to the server page too (it opens one from the address). */
export const TAB_IDS = ["portfolio", "transactions", "dividends", "rebalance", "investors", "watchlist", "alerts", "import"] as const;
export type Tab = (typeof TAB_IDS)[number];
export const isTab = (v: string | undefined): v is Tab => (TAB_IDS as readonly string[]).includes(v ?? "");
