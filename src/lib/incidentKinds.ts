/** Statuses and impacts of posted incidents (client-safe: no database). */
export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const IMPACTS = ["minor", "major", "maintenance"] as const;
export type Impact = (typeof IMPACTS)[number];
