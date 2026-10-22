// The records an update leaves in app_meta for the next start: read by db.ts (to put the database
// back after a rollback) and by apply.ts (to record how the update went). Plain data, no imports,
// so db.ts can depend on it.

export const PENDING = "update.pending";
export const RESTORED = "update.restored";

/** Written just before the handover to the helper; cleared once the next start has recorded the outcome. */
export interface Pending {
  from: string;
  fromBuild: string;
  to: string;
  image: string;
  user: string | null;
  startedAt: number;
  /** Database copy taken just before the handover: put back if the helper rolls back (see db.ts). */
  snapshot?: string;
}

/** Left when a rollback put the pre-update copy back: what was saved in the newer version is only in `kept`. */
export interface RestoredDb {
  snapshot: string;
  kept: string;
  at: string;
}
