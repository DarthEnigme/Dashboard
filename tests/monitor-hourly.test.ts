import { describe, expect, it } from "vitest";
import { hourlyPass } from "@/lib/monitor";

const HOUR = 3_600_000;

describe("the hourly pass", () => {
  it("runs beside the checks: a slow job doesn't hold up the tick, and passes never overlap", async () => {
    let release!: () => void;
    const ran: string[] = [];
    const state = {
      lastMaintenance: 0,
      hourly: [
        () => new Promise<void>((r) => (release = () => (ran.push("slow"), r()))),
        async () => void ran.push("after"),
        async () => {
          throw new Error("one job failing doesn't stop the others");
        },
        async () => void ran.push("last"),
      ],
    };
    const now = 10 * HOUR;
    const pass = hourlyPass(state, 90, now);
    expect(pass).toBeInstanceOf(Promise);
    // The slow job is still going: the tick has returned, and the next pass due waits for it.
    expect(ran).toEqual([]);
    expect(hourlyPass(state, 90, now + 2 * HOUR)).toBeUndefined();

    await new Promise((r) => setTimeout(r, 0));
    release();
    await pass;
    expect(ran).toEqual(["slow", "after", "last"]);
    expect(state).not.toHaveProperty("maintaining", expect.anything());

    expect(hourlyPass(state, 90, now + HOUR / 2)).toBeUndefined(); // not due yet
    expect(hourlyPass(state, 90, now + 2 * HOUR)).toBeInstanceOf(Promise);
  });
});
