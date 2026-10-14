import { db } from "./db";

/**
 * Incidents written by admins for the public status page, each with a timeline of updates
 * ("Investigating: the NAS is not answering" → "Resolved: a disk was replaced"). Outages found by
 * the checks are separate (the incidents table); these say what people should know.
 */
import { IMPACTS, INCIDENT_STATUSES, type Impact, type IncidentStatus } from "./incidentKinds";

export { IMPACTS, INCIDENT_STATUSES, type Impact, type IncidentStatus };

export interface IncidentUpdate {
  id: number;
  status: IncidentStatus;
  body: string;
  at: number;
  by: string | null;
}

export interface PostedIncident {
  id: number;
  title: string;
  status: IncidentStatus;
  impact: Impact;
  /** Service ids it is about; empty for everything (or nothing in particular). */
  services: string[];
  created_at: number;
  resolved_at: number | null;
  created_by: string | null;
  /** Newest first. */
  updates: IncidentUpdate[];
}

type Row = Omit<PostedIncident, "services" | "updates"> & { services: string };

const MAX_BODY = 5000;

function hydrate(r: Row): PostedIncident {
  const updates = db().prepare("SELECT id, status, body, at, by FROM status_updates WHERE incident_id = ? ORDER BY at DESC, id DESC").all(r.id) as unknown as IncidentUpdate[];
  let services: string[] = [];
  try {
    services = (JSON.parse(r.services) as unknown[]).filter((s): s is string => typeof s === "string");
  } catch {}
  return { ...r, services, updates };
}

const clean = {
  title(v: unknown) {
    const t = typeof v === "string" ? v.trim().slice(0, 200) : "";
    if (!t) throw new Error("Title required");
    return t;
  },
  status(v: unknown): IncidentStatus {
    if (!(INCIDENT_STATUSES as readonly unknown[]).includes(v)) throw new Error("Status must be investigating, identified, monitoring or resolved");
    return v as IncidentStatus;
  },
  impact(v: unknown): Impact {
    return (IMPACTS as readonly unknown[]).includes(v) ? (v as Impact) : "minor";
  },
  body(v: unknown) {
    const b = typeof v === "string" ? v.trim() : "";
    if (b.length > MAX_BODY) throw new Error("An update can hold up to 5,000 characters");
    return b;
  },
  services(v: unknown) {
    return Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string" && /^[\w.-]{1,200}$/.test(s)))].slice(0, 100) : [];
  },
};

export function getIncident(id: number): PostedIncident | undefined {
  const r = db().prepare("SELECT * FROM status_incidents WHERE id = ?").get(id) as Row | undefined;
  return r && hydrate(r);
}

/** Open incidents first (newest first), then those resolved since `since`. */
export function listIncidents(since = 0): PostedIncident[] {
  const rows = db()
    .prepare("SELECT * FROM status_incidents WHERE resolved_at IS NULL OR resolved_at >= ? ORDER BY resolved_at IS NOT NULL, created_at DESC LIMIT 200")
    .all(since) as unknown as Row[];
  return rows.map(hydrate);
}

/** { title, impact?, services?, status?, body } — the first update is posted with it. */
export function createIncident(b: Record<string, unknown>, by: string | null, now = Date.now()): PostedIncident {
  const title = clean.title(b.title);
  const status = b.status === undefined ? "investigating" : clean.status(b.status);
  const res = db()
    .prepare("INSERT INTO status_incidents (title, status, impact, services, created_at, resolved_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(title, status, clean.impact(b.impact), JSON.stringify(clean.services(b.services)), now, status === "resolved" ? now : null, by);
  const id = Number(res.lastInsertRowid);
  db().prepare("INSERT INTO status_updates (incident_id, status, body, at, by) VALUES (?, ?, ?, ?, ?)").run(id, status, clean.body(b.body), now, by);
  return getIncident(id)!;
}

/** Post an update: { status, body }. It sets the incident's status; "resolved" closes it (and another status reopens it). */
export function addUpdate(id: number, b: Record<string, unknown>, by: string | null, now = Date.now()): PostedIncident {
  const cur = getIncident(id);
  if (!cur) throw new Error("No such incident");
  const status = clean.status(b.status ?? cur.status);
  const body = clean.body(b.body);
  if (!body && status === cur.status) throw new Error("Write what changed");
  db().prepare("INSERT INTO status_updates (incident_id, status, body, at, by) VALUES (?, ?, ?, ?, ?)").run(id, status, body, now, by);
  db()
    .prepare("UPDATE status_incidents SET status = ?, resolved_at = ? WHERE id = ?")
    .run(status, status === "resolved" ? (cur.resolved_at ?? now) : null, id);
  return getIncident(id)!;
}

/** Change the title, impact or services of an incident (its timeline stays). */
export function editIncident(id: number, b: Record<string, unknown>): PostedIncident {
  const cur = getIncident(id);
  if (!cur) throw new Error("No such incident");
  db()
    .prepare("UPDATE status_incidents SET title = ?, impact = ?, services = ? WHERE id = ?")
    .run(
      b.title === undefined ? cur.title : clean.title(b.title),
      b.impact === undefined ? cur.impact : clean.impact(b.impact),
      JSON.stringify(b.services === undefined ? cur.services : clean.services(b.services)),
      id,
    );
  return getIncident(id)!;
}

export function deleteIncident(id: number) {
  db().prepare("DELETE FROM status_incidents WHERE id = ?").run(id);
}

/** Drop the update with this id (a typo); an incident keeps at least one. */
export function deleteUpdate(incidentId: number, updateId: number): PostedIncident {
  const cur = getIncident(incidentId);
  if (!cur) throw new Error("No such incident");
  if (cur.updates.length <= 1) throw new Error("An incident keeps at least one update; delete the incident instead");
  db().prepare("DELETE FROM status_updates WHERE id = ? AND incident_id = ?").run(updateId, incidentId);
  const latest = getIncident(incidentId)!.updates[0];
  db().prepare("UPDATE status_incidents SET status = ?, resolved_at = ? WHERE id = ?").run(latest.status, latest.status === "resolved" ? latest.at : null, incidentId);
  return getIncident(incidentId)!;
}
