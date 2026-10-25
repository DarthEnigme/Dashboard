import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addUpdate, createIncident } from "@/lib/statusIncidents";

const auth = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ username: "root" })),
  sameOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAdmin: auth.requireAdmin,
  sameOrigin: auth.sameOrigin,
}));

type Ctx = { params: Promise<{ id: string }> };

function ctx(id: number): Ctx {
  return { params: Promise.resolve({ id: String(id) }) };
}

function audits() {
  return db().prepare("SELECT user, action, detail FROM audit ORDER BY rowid").all() as {
    user: string | null;
    action: string;
    detail: string | null;
  }[];
}

beforeEach(() => {
  db().exec("DELETE FROM audit; DELETE FROM status_incidents;");
  auth.requireAdmin.mockResolvedValue({ username: "root" });
  auth.sameOrigin.mockReturnValue(true);
});

describe("status incident audit trail", () => {
  it("audits an incident edit", async () => {
    const inc = createIncident({ title: "Photos are slow" }, null, 1000);
    const { PATCH } = await import("@/app/api/status-incidents/[id]/route");

    const res = await PATCH(
      new Request(`http://localhost/api/status-incidents/${inc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Photos were slow" }),
      }),
      ctx(inc.id),
    );

    expect(res.status).toBe(200);
    expect(audits()).toEqual([
      { user: "root", action: "incident-edit", detail: JSON.stringify({ id: inc.id, title: "Photos were slow" }) },
    ]);
  });

  it("audits a single update deletion", async () => {
    const inc = createIncident({ title: "Photos are slow", body: "Looking into it" }, null, 1000);
    // An incident keeps at least one update, so delete a second one.
    const second = addUpdate(inc.id, { status: "identified", body: "Found it" }, null, 2000);
    const updateId = second.updates[0].id;
    const { DELETE } = await import("@/app/api/status-incidents/[id]/route");

    const res = await DELETE(
      new Request(`http://localhost/api/status-incidents/${inc.id}?update=${updateId}`, { method: "DELETE" }),
      ctx(inc.id),
    );

    expect(res.status).toBe(200);
    expect(audits()).toEqual([
      { user: "root", action: "incident-update-delete", detail: JSON.stringify({ id: inc.id, update: updateId }) },
    ]);
  });
});
