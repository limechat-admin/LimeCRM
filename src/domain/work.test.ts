import { describe, expect, it } from "vitest";
import { bucketTasks, daysSince, dueAtFromDay, isStale, istDay, taskBucket } from "./work";

// 21 Oct 2026, 10:00 IST
const now = new Date("2026-10-21T04:30:00Z");

describe("istDay", () => {
  it("uses the IST calendar day, not UTC", () => {
    expect(istDay(new Date("2026-10-20T19:00:00Z"))).toBe("2026-10-21"); // 00:30 IST
    expect(istDay(new Date("2026-10-20T18:00:00Z"))).toBe("2026-10-20"); // 23:30 IST
  });
});

describe("taskBucket", () => {
  it("sorts tasks into overdue, today, upcoming and someday", () => {
    expect(taskBucket(dueAtFromDay("2026-10-20"), now)).toBe("overdue");
    expect(taskBucket(dueAtFromDay("2026-10-21"), now)).toBe("today");
    expect(taskBucket(new Date("2026-10-21T02:00:00Z"), now)).toBe("today"); // earlier today is still today
    expect(taskBucket(dueAtFromDay("2026-10-22"), now)).toBe("upcoming");
    expect(taskBucket(null, now)).toBe("someday");
  });

  it("orders each bucket by due date", () => {
    const later = { id: "b", dueAt: dueAtFromDay("2026-10-30") };
    const sooner = { id: "a", dueAt: dueAtFromDay("2026-10-23") };
    expect(bucketTasks([later, sooner], now).upcoming.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("staleness", () => {
  it("counts whole days since the last touch", () => {
    expect(daysSince(new Date("2026-10-07T04:30:00Z"), now)).toBe(14);
    expect(daysSince(null, now)).toBeNull();
  });

  it("flags deals untouched for 14+ days, or never touched", () => {
    expect(isStale(new Date("2026-10-07T04:30:00Z"), now)).toBe(true);
    expect(isStale(new Date("2026-10-08T04:30:00Z"), now)).toBe(false);
    expect(isStale(null, now)).toBe(true);
  });
});

describe("dueAtFromDay", () => {
  it("means end of the working day in IST", () => {
    expect(dueAtFromDay("2026-10-21").toISOString()).toBe("2026-10-21T12:30:00.000Z");
  });
});
