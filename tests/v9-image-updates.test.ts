import { describe, expect, it } from "vitest";
import { checkImage, imageUpdate, pendingImageChecks } from "@/lib/imageUpdates";
import { imageField } from "@/integrations/docker";

/** A fake Docker client: local RepoDigests per ref, and the registry's current digest. */
function fakeClient(local: Record<string, string[]>, remote: Record<string, string | Error>, calls: string[] = []) {
  return {
    getImage: (ref: string) => ({
      inspect: async () => {
        calls.push(`inspect ${ref}`);
        if (!(ref in local)) throw new Error("No such image");
        return { RepoDigests: local[ref] };
      },
      distribution: async () => {
        calls.push(`distribution ${ref}`);
        const r = remote[ref];
        if (r instanceof Error) throw r;
        return { Descriptor: { digest: r } };
      },
    }),
  } as never;
}

describe("image update checks", () => {
  it("compares the registry's digest with the ones the image was pulled as", async () => {
    const client = fakeClient(
      { "nginx:latest": ["nginx@sha256:old", "docker.io/library/nginx@sha256:old2"], "ghcr.io/me/app:1": ["ghcr.io/me/app@sha256:same"] },
      { "nginx:latest": "sha256:new", "ghcr.io/me/app:1": "sha256:same" },
    );
    expect((await checkImage(client, "nginx:latest")).state).toBe("update");
    expect((await checkImage(client, "ghcr.io/me/app:1")).state).toBe("current");
  });

  it("skips pinned and locally built images, and reports registry errors as unknown", async () => {
    const calls: string[] = [];
    const client = fakeClient(
      { "mine:dev": [], "built:latest": ["built@sha256:x"], "app:2": ["app@sha256:x"] },
      { "built:latest": new Error("(HTTP code 403) denied: requested access to the resource is denied"), "app:2": new Error("connect ETIMEDOUT") },
      calls,
    );
    expect((await checkImage(client, "redis@sha256:abc")).state).toBe("pinned");
    expect((await checkImage(client, "mine:dev")).state).toBe("local");
    expect(calls).not.toContain("distribution mine:dev");
    // Docker Desktop records digests for locally built images too; the registry then refuses.
    expect((await checkImage(client, "built:latest")).state).toBe("local");
    expect(await checkImage(client, "app:2")).toMatchObject({ state: "unknown", error: "connect ETIMEDOUT" });
  });

  it("answers from cache and refreshes in the background, keyed by the local image", async () => {
    const calls: string[] = [];
    const client = fakeClient({ "app:1": ["app@sha256:a"] }, { "app:1": "sha256:b" }, calls);
    const t0 = 1_000_000;
    expect(imageUpdate(client, "h", "app:1", "img1", t0)).toBeUndefined();
    await pendingImageChecks();
    expect(imageUpdate(client, "h", "app:1", "img1", t0 + 1000)?.state).toBe("update");
    const before = calls.length;
    imageUpdate(client, "h", "app:1", "img1", t0 + 60_000);
    expect(calls.length).toBe(before); // still fresh
    // A new local image (after a pull) is checked again right away.
    expect(imageUpdate(client, "h", "app:1", "img2", t0 + 60_000)).toBeUndefined();
    await pendingImageChecks();
    expect(calls.length).toBeGreaterThan(before);
  });

  it("only shows a field when an update is available", () => {
    expect(imageField({ state: "update", checkedAt: 0 })).toEqual([{ label: "Image", value: "update available", status: "warn" }]);
    expect(imageField({ state: "current", checkedAt: 0 })).toEqual([]);
    expect(imageField(undefined)).toEqual([]);
  });
});
