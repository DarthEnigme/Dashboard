import { NextResponse } from "next/server";
import { crudRoutes } from "@/lib/api";
import { addConnection, deleteConnection, listConnections, startSync } from "@/lib/stocks/brokers/sync";
import { guard } from "../_shared";

export const dynamic = "force-dynamic";

/** Your connections to brokers (never their keys): last sync, its error, whether one is running. */
export async function GET() {
  const g = await guard();
  if ("error" in g) return g.error;
  return NextResponse.json(listConnections(g.user.id));
}

/** POST { kind: t212 | ibkr, portfolio, secret, account? }. PATCH { id }: sync now. DELETE ?id=. Each answers with the connections. */
export const { POST, PATCH, DELETE } = crudRoutes(
  guard,
  {
    // A new connection syncs at once.
    create: (u, b) => {
      const id = addConnection(u, b);
      void startSync(u, id);
    },
    // PATCH { id }: sync now (it runs on; GET shows when it is done).
    update: (u, b) => void startSync(u, Number(b.id)).catch(() => {}),
    remove: deleteConnection,
  },
  (u) => listConnections(u),
);
