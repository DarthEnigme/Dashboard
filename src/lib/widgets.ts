import { cached } from "./cache";
import { integrations } from "@/integrations";
import { toResult, type WidgetResult, type WidgetSpark } from "@/integrations/types";
import type { Service } from "./config/schema";
import { applyThresholds, widgetExtras } from "./thresholds";
import { metricSeries, thin } from "./metrics";

export class WidgetError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TTL = 10_000;

/**
 * A service's widget data, validated and cached for 10 s (the page and the monitor share it).
 * Threshold rules colour the matching fields; recorded widgets without sparklines of their own
 * get some from their history.
 */
export async function fetchWidget(id: string, service: Service): Promise<WidgetResult> {
  if (!service.widget) throw new WidgetError("Unknown service", 404);
  const integration = integrations[service.widget.type];
  if (!integration) throw new WidgetError(`Unknown widget type "${service.widget.type}"`, 400);
  const parsed = integration.schema.safeParse(service.widget);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new WidgetError(`Invalid widget config: ${msg}`, 400);
  }
  // Keyed on the config too, so edits take effect immediately.
  const key = `widget|${id}|${JSON.stringify(parsed.data)}`;
  const result = await cached(key, TTL, async () => toResult(await integration.fetch(parsed.data, { serviceName: service.name })));
  const extras = widgetExtras(service.widget);
  let out = applyThresholds(result, extras.thresholds);
  if (extras.record && !out.sparks?.length) out = { ...out, sparks: historySparks(id) };
  return out;
}

/** Up to three sparklines from the last 6 hours of recorded values. */
function historySparks(id: string): WidgetSpark[] | undefined {
  try {
    const now = Date.now();
    const series = metricSeries(id, now - 6 * 3_600_000, now + 1, false);
    const sparks = [...series]
      .filter(([, pts]) => pts.length > 2)
      .slice(0, 3)
      .map(([label, pts]) => {
        const values = thin(pts, 40).map((p) => p.v);
        const last = values[values.length - 1];
        return { label, values, current: Number.isInteger(last) ? String(last) : last.toFixed(1) };
      });
    return sparks.length ? sparks : undefined;
  } catch {
    return undefined; // no database
  }
}
