"use client";

import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cpu,
  HardDrive,
  MemoryStick,
  Moon,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import type { ClientInfoWidget } from "@/lib/config/sanitize";
import type { CurrencyData, MarketsData, ResourcesData, StatsData, WeatherData } from "@/info/types";
import { bytes, duration } from "@/integrations/format";

export function InfoBar({ widgets }: { widgets: ClientInfoWidget[] }) {
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {widgets.map((w, i) => {
        switch (w.type) {
          case "greeting":
            return <Greeting key={i} name={w.name as string} hour12={!!w.hour12} timezone={w.timezone as string} />;
          case "weather":
            return <Remote key={i} index={i} interval={600}>{(d: WeatherData) => <Weather d={d} />}</Remote>;
          case "resources":
            return <Remote key={i} index={i} interval={10}>{(d: ResourcesData) => <Resources d={d} label={w.label as string} />}</Remote>;
          case "glances":
            return <Remote key={i} index={i} interval={10}>{(d: ResourcesData) => <Resources d={d} label={w.label as string} />}</Remote>;
          case "prometheus":
            return <Remote key={i} index={i} interval={15}>{(d: StatsData) => <Stats d={d} />}</Remote>;
          case "markets":
            return <Remote key={i} index={i} interval={300}>{(d: MarketsData) => <Markets d={d} />}</Remote>;
          case "currency":
            return <Remote key={i} index={i} interval={3600}>{(d: CurrencyData) => <Currency d={d} />}</Remote>;
          default:
            return <Chip key={i}><span className="text-sm text-muted">Unknown widget “{w.type}”</span></Chip>;
        }
      })}
    </div>
  );
}

function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass flex min-h-16 items-center gap-4 rounded-2xl px-4 py-3 ${className}`}>{children}</div>;
}

function Remote<T>({ index, interval, children }: { index: number; interval: number; children: (d: T) => ReactNode }) {
  const { data, error } = useSWR<T>(`/api/info/${index}`, fetcher, { refreshInterval: interval * 1000, keepPreviousData: true });
  if (error && !data) {
    return (
      <Chip>
        <span className="flex items-center gap-2 text-sm text-[var(--err)]" title={error.message}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="max-w-60 truncate">{error.message}</span>
        </span>
      </Chip>
    );
  }
  if (!data) return <Chip className="w-40 animate-pulse"><span /></Chip>;
  return <>{children(data)}</>;
}

function Greeting({ name, hour12, timezone }: { name?: string; hour12: boolean; timezone?: string }) {
  const [now, setNow] = useState<Date>();
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // Render nothing time-dependent on the server to avoid hydration mismatches.
  if (!now) return <Chip className="w-56"><span /></Chip>;

  const opts = { timeZone: timezone || undefined };
  const hour = Number(new Intl.DateTimeFormat("en-GB", { ...opts, hour: "numeric", hour12: false }).format(now));
  const part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <Chip className="mr-auto">
      <div>
        <div className="text-sm text-muted">{name ? `${part}, ${name}` : part}</div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tabular-nums">
            {now.toLocaleTimeString([], { ...opts, hour: "2-digit", minute: "2-digit", hour12 })}
          </span>
          <span className="text-sm text-muted">
            {now.toLocaleDateString([], { ...opts, weekday: "long", day: "numeric", month: "long" })}
          </span>
        </div>
      </div>
    </Chip>
  );
}

/** WMO weather interpretation codes, as used by Open-Meteo. */
function weatherLook(code: number, isDay: boolean): { icon: LucideIcon; text: string } {
  if (code === 0) return { icon: isDay ? Sun : Moon, text: "Clear" };
  if (code <= 2) return { icon: isDay ? CloudSun : Cloud, text: "Partly cloudy" };
  if (code === 3) return { icon: Cloud, text: "Overcast" };
  if (code <= 48) return { icon: CloudFog, text: "Fog" };
  if (code <= 57) return { icon: CloudDrizzle, text: "Drizzle" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { icon: CloudRain, text: "Rain" };
  if (code <= 77 || code === 85 || code === 86) return { icon: CloudSnow, text: "Snow" };
  return { icon: CloudLightning, text: "Thunderstorm" };
}

function Weather({ d }: { d: WeatherData }) {
  const { icon: WIcon, text } = weatherLook(d.code, d.isDay);
  const deg = d.units === "imperial" ? "°F" : "°C";
  return (
    <Chip>
      <WIcon className="h-8 w-8 text-accent" />
      <div>
        <div className="text-sm text-muted">{d.label ? `${d.label} · ${text}` : text}</div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tabular-nums">{d.temp}{deg}</span>
          <span className="text-xs text-muted tabular-nums">
            ↑{d.high}° ↓{d.low}° <Wind className="ml-1 inline h-3 w-3" /> {d.wind} {d.units === "imperial" ? "mph" : "km/h"}
          </span>
        </div>
      </div>
    </Chip>
  );
}

function Meter({ icon: MIcon, label, ratio, detail }: { icon: LucideIcon; label: string; ratio: number; detail: string }) {
  const color = ratio >= 0.9 ? "bg-[var(--err)]" : ratio >= 0.75 ? "bg-[var(--warn)]" : "bg-accent";
  return (
    <div className="w-28" title={detail}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-muted">
          <MIcon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="font-semibold tabular-nums">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-track">
        <div className={`h-full rounded-full transition-[width] duration-700 ${color}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
      </div>
    </div>
  );
}

function Resources({ d, label }: { d: ResourcesData; label?: string }) {
  return (
    <Chip className="flex-wrap">
      {label && <span className="text-sm font-medium">{label}</span>}
      <Meter icon={Cpu} label="CPU" ratio={d.cpu} detail={`CPU ${Math.round(d.cpu * 100)}%`} />
      <Meter icon={MemoryStick} label="RAM" ratio={d.mem.used / d.mem.total} detail={`${bytes(d.mem.used)} / ${bytes(d.mem.total)}`} />
      {d.disks.map((disk) => (
        <Meter key={disk.mount} icon={HardDrive} label={disk.mount} ratio={disk.used / disk.total} detail={`${bytes(disk.used)} / ${bytes(disk.total)}`} />
      ))}
      <div className="flex flex-col gap-0.5 text-xs text-muted">
        {d.temp !== null && (
          <span className="flex items-center gap-1">
            <Thermometer className="h-3.5 w-3.5" /> <span className="text-fg tabular-nums">{Math.round(d.temp)}°C</span>
          </span>
        )}
        <span>up {duration(d.uptime)}</span>
      </div>
    </Chip>
  );
}

const statColor = { ok: "text-fg", warn: "text-[var(--warn)]", error: "text-[var(--err)]" } as const;

function Stats({ d }: { d: StatsData }) {
  return (
    <Chip className="flex-wrap gap-x-5">
      {d.label && <span className="text-sm font-medium">{d.label}</span>}
      {d.stats.map((s) => (
        <div key={s.label}>
          <div className="text-xs font-medium text-muted uppercase">{s.label}</div>
          <div className={`font-semibold tabular-nums ${statColor[s.status ?? "ok"]}`}>{s.value}</div>
        </div>
      ))}
    </Chip>
  );
}

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: n < 10 ? 4 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

function Markets({ d }: { d: MarketsData }) {
  return (
    <Chip className="flex-wrap gap-x-5">
      {d.quotes.map((q) => {
        const up = (q.change ?? 0) >= 0;
        const Trend = up ? TrendingUp : TrendingDown;
        return (
          <div key={q.symbol} title={q.name ?? q.symbol}>
            <div className="text-xs font-medium text-muted uppercase">{q.symbol}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold tabular-nums">{money(q.price, q.currency)}</span>
              {q.change !== null && (
                <span className={`flex items-center gap-0.5 text-xs tabular-nums ${up ? "text-[var(--ok)]" : "text-[var(--err)]"}`}>
                  <Trend className="h-3 w-3" />
                  {Math.abs(q.change).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
      {d.errors.length > 0 && (
        <span title={d.errors.join("\n")}>
          <AlertTriangle className="h-4 w-4 text-[var(--warn)]" />
        </span>
      )}
    </Chip>
  );
}

function Currency({ d }: { d: CurrencyData }) {
  return (
    <Chip className="flex-wrap gap-x-5" >
      <span className="text-xs text-muted" title={`ECB reference rates, ${d.date}`}>1 {d.base} =</span>
      {d.rates.map((r) => (
        <div key={r.symbol}>
          <div className="text-xs font-medium text-muted">{r.symbol}</div>
          <div className="font-semibold tabular-nums">{r.rate.toFixed(r.rate < 10 ? 4 : 2)}</div>
        </div>
      ))}
    </Chip>
  );
}
