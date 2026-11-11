"use client";

import { useMemo, useRef } from "react";
import type { StocksData } from "@/lib/stocks/types";
import { composition } from "@/lib/stocks/composition";
import { useT } from "@/i18n/client";
import { ChartExport } from "../charts/ChartExport";
import { LayeredSankey } from "../charts/LayeredSankey";
import { cash, percent } from "./format";
import { Card } from "./parts";

/** What the portfolio is made of, as a flow: portfolios (when shown together) → sectors → holdings. */
export function Composition({ data }: { data: StocksData }) {
  const t = useT();
  const chart = useRef<HTMLDivElement>(null);
  const flow = useMemo(() => composition(data, { unclassified: t("Unclassified"), other: t("Other") }), [data, t]);
  if (flow.nodes.length < 2) return null;
  const columns = [...(data.byPortfolio.length ? [t("Portfolios")] : []), t("Sectors"), t("Holdings")];
  return (
    <Card title={t("Composition")} action={<ChartExport chart={chart} name="portfolio-composition" />}>
      <div ref={chart}>
        <LayeredSankey
          nodes={flow.nodes}
          links={flow.links}
          columns={columns}
          height={Math.min(560, Math.max(240, flow.nodes.filter((n) => n.layer === columns.length - 1).length * 26))}
          format={(v) => cash(v, data.currency)}
          share={(v) => percent((v / (data.value || 1)) * 100, false)}
          ariaLabel={t("What the portfolio is made of, by sector and holding")}
        />
      </div>
    </Card>
  );
}
