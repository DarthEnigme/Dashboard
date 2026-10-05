import { z } from "zod";
import { promClient, promConnection, promQuerySchema } from "@/integrations/prometheus";
import { metricField } from "@/integrations/metrics";
import type { InfoProvider, StatsData } from "./types";

const schema = z.object({
  ...promConnection,
  label: z.string().optional(),
  queries: z.array(promQuerySchema.omit({ chart: true })).min(1),
});

/** A few PromQL numbers in the info bar (cluster CPU, alerts firing, power draw…). */
export const prometheusInfo: InfoProvider<typeof schema, StatsData> = {
  type: "prometheus",
  schema,
  ttlMs: 15_000,
  async fetch(cfg) {
    const client = promClient(cfg);
    const values = await Promise.all(cfg.queries.map((q) => client.instant(q.query).catch(() => undefined)));
    if (values.every((v) => v === undefined)) await client.instant(cfg.queries[0].query); // surface the error
    return { label: cfg.label, stats: cfg.queries.map((q, i) => metricField(q.label, values[i], q)) };
  },
};
