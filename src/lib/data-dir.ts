import path from "node:path";

/** Where the database, snapshots and uploads live. Its own module so snapshots.ts can use it without importing db.ts. */
export const DATA_DIR = process.env.HOMEPAGE_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data");
