import type { ServiceAction, WidgetResult } from "./types";

// Shared by the Docker managers (Dockhand, Arcane): container summaries into fields, rows and actions.

export interface ContainerSummary {
  id: string;
  name: string;
  /** Docker state: running, exited, paused, restarting, created, dead. */
  state: string;
  /** Docker's status text, e.g. "Up 2 hours (healthy)". */
  status: string;
  updateAvailable?: boolean;
}

const health = (status: string) => (/\(unhealthy\)/i.test(status) ? "unhealthy" : /\(healthy\)/i.test(status) ? "healthy" : undefined);

export function parseContainers(containers: ContainerSummary[], extra: { stacks?: number; updates?: boolean } = {}): WidgetResult {
  const running = containers.filter((c) => c.state === "running");
  const unhealthy = containers.filter((c) => health(c.status) === "unhealthy");
  const restarting = containers.filter((c) => c.state === "restarting");
  const stopped = containers.length - running.length;
  const updates = containers.filter((c) => c.updateAvailable).length;

  const result: WidgetResult = {
    fields: [
      { label: "Running", value: running.length, status: "ok" },
      { label: "Stopped", value: stopped, status: stopped ? "warn" : "ok" },
    ],
  };
  if (unhealthy.length || restarting.length) result.fields.push({ label: "Unhealthy", value: unhealthy.length + restarting.length, status: "error" });
  if (extra.stacks !== undefined) result.fields.push({ label: "Stacks", value: extra.stacks });
  if (extra.updates) result.fields.push({ label: "Updates", value: updates, status: updates ? "warn" : "ok" });

  // Problems first, then running, then stopped; alphabetical within each.
  const rank = (c: ContainerSummary) => (health(c.status) === "unhealthy" || c.state === "restarting" ? 0 : c.state === "running" ? 1 : 2);
  result.list = [...containers]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map((c) => ({
      label: c.updateAvailable ? `${c.name} ↑` : c.name,
      value: health(c.status) ?? c.state,
      status: rank(c) === 0 ? "error" : c.state === "running" ? undefined : "warn",
    }));
  return result;
}

/** Start/stop/restart per container; target is "<environment>/<container id>". */
export function containerActions(env: string | number, containers: ContainerSummary[]): ServiceAction[] {
  return [...containers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((c) => {
      const target = `${env}/${c.id}`;
      return c.state === "running"
        ? [
            { id: "restart", label: "Restart", target, targetLabel: c.name },
            { id: "stop", label: "Stop", target, targetLabel: c.name, danger: true },
          ]
        : [{ id: "start", label: "Start", target, targetLabel: c.name }];
    });
}

export const CONTAINER_ACTIONS = ["start", "stop", "restart"] as const;

/** Validate an action target against the configured environment; returns the container id. */
export function containerTarget(env: string | number, action: string, target?: string): string {
  const m = /^([\w-]+)\/([a-f0-9]{12,64})$/.exec(target ?? "");
  if (!m || m[1] !== String(env) || !(CONTAINER_ACTIONS as readonly string[]).includes(action)) throw new Error("Invalid action");
  return m[2];
}

export const actionDone = (name: string, action: string) => `${name}: ${action === "stop" ? "stopped" : action === "start" ? "started" : "restarted"}`;
