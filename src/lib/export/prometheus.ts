import { getConfig } from "../config";
import { serviceIds } from "../config/slug";
import { checkSpec } from "../checks";
import { latestPing, pingsSince } from "../db";
import { latestMetrics } from "../metrics";
import { buildInfo } from "../version";

/** A label value as the Prometheus text format wants it. */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (l: Record<string, string>) => `{${Object.entries(l).map(([k, v]) => `${k}="${esc(v)}"`).join(",")}}`;

interface Family {
  name: string;
  help: string;
  type: "gauge";
  samples: { labels: Record<string, string>; value: number }[];
}

export function renderMetrics(families: Family[]): string {
  return (
    families
      .filter((f) => f.samples.length)
      .map((f) => [`# HELP ${f.name} ${f.help}`, `# TYPE ${f.name} ${f.type}`, ...f.samples.map((s) => `${f.name}${labels(s.labels)} ${Number.isFinite(s.value) ? s.value : "NaN"}`)].join("\n"))
      .join("\n") + "\n"
  );
}

/**
 * Page's numbers for Prometheus: every checked service's state, latency and 24-hour uptime, the
 * latest recorded widget values, and the version.
 */
export async function collectMetrics(now = Date.now()): Promise<string> {
  const { services } = await getConfig();
  const ids = serviceIds(services);
  const up: Family = { name: "page_service_up", help: "1 when the service's last status check passed, 0 when it failed.", type: "gauge", samples: [] };
  const latency: Family = { name: "page_service_latency_ms", help: "Response time of the service's last status check, in milliseconds.", type: "gauge", samples: [] };
  const uptime: Family = { name: "page_service_uptime_ratio", help: "Share of the status checks that passed over the last 24 hours (0-1).", type: "gauge", samples: [] };
  const checked: Family = { name: "page_service_last_check_timestamp_seconds", help: "When the service was last checked (Unix time).", type: "gauge", samples: [] };
  services.forEach((g, gi) =>
    g.services.forEach((s, si) => {
      if (!checkSpec(s)) return;
      const id = ids[gi][si];
      const l = { service: id, name: s.name, group: g.name };
      const last = latestPing(id);
      if (!last) return;
      up.samples.push({ labels: l, value: last.up ? 1 : 0 });
      if (last.latency_ms !== null) latency.samples.push({ labels: l, value: last.latency_ms });
      checked.samples.push({ labels: l, value: Math.round(last.ts / 1000) });
      const day = pingsSince(id, now - 86_400_000);
      if (day.length) uptime.samples.push({ labels: l, value: Math.round((day.filter((p) => p.up).length / day.length) * 10_000) / 10_000 });
    }),
  );
  const widget: Family = { name: "page_widget_value", help: "Latest recorded value of a widget field (widgets with record: true or thresholds).", type: "gauge", samples: [] };
  for (const m of latestMetrics(now - 3_600_000)) widget.samples.push({ labels: { service: m.service_id, field: m.key }, value: m.value });
  const info: Family = { name: "page_build_info", help: "The running version of Page.", type: "gauge", samples: [{ labels: { version: buildInfo().version }, value: 1 }] };
  return renderMetrics([up, latency, uptime, checked, widget, info]);
}
