import { describe, expect, it } from "vitest";
import { addMonths, fromSalesmateStage, reconnectBucket, reconnectDateFor } from "./reconnect";

describe("addMonths", () => {
  it("adds calendar months and clamps to the month's end", () => {
    expect(addMonths("2026-10-22", 1)).toBe("2026-11-22");
    expect(addMonths("2026-10-22", 3)).toBe("2027-01-22");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-08-31", 6)).toBe("2027-02-28");
  });
});

describe("reconnectDateFor", () => {
  it("counts from today in IST", () => {
    // 20:00 UTC on 21 Oct is already 22 Oct in India.
    expect(reconnectDateFor("3m", new Date("2026-10-21T20:00:00Z"))).toBe("2027-01-22");
  });
});

describe("reconnectBucket", () => {
  const now = new Date("2026-10-22T06:00:00Z");
  it("splits overdue, this week and later", () => {
    expect(reconnectBucket("2026-10-21", now)).toBe("overdue");
    expect(reconnectBucket("2026-10-22", now)).toBe("this_week");
    expect(reconnectBucket("2026-10-29", now)).toBe("this_week");
    expect(reconnectBucket("2026-10-30", now)).toBe("later");
  });
});

describe("fromSalesmateStage", () => {
  it("maps the Reconnect pipeline's stages", () => {
    expect(fromSalesmateStage("Reconnect in 6 months")).toEqual({ months: 6, reason: "Salesmate: Reconnect in 6 months" });
    expect(fromSalesmateStage("Reconnect Enterprise")?.months).toBe(6);
    expect(fromSalesmateStage("New (Untouched)")?.months).toBe(1);
    expect(fromSalesmateStage("Something else")).toBeNull();
  });
});
