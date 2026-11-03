import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  canEdit: vi.fn(async () => true),
  sameOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  canEdit: auth.canEdit,
  sameOrigin: auth.sameOrigin,
}));

beforeEach(() => {
  auth.canEdit.mockReset().mockResolvedValue(true);
  auth.sameOrigin.mockReset().mockReturnValue(true);
});

const put = () =>
  new Request("http://localhost/api/config", { method: "PUT", body: JSON.stringify({ file: "settings.yaml", data: {} }) });

describe("PUT /api/config", () => {
  it("answers 401 when the caller is not an editor", async () => {
    auth.canEdit.mockResolvedValue(false);
    const { PUT } = await import("@/app/api/config/route");

    const res = await PUT(put());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("answers 403 for a cross-site request, not 401", async () => {
    auth.sameOrigin.mockReturnValue(false);
    const { PUT } = await import("@/app/api/config/route");

    const res = await PUT(put());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-site request refused" });
  });
});
