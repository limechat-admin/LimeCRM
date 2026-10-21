import { describe, expect, it } from "vitest";
import { daysBetween, inRange, monthsIn, parseRange, rangeParam, todayIst } from "./range";

describe("parseRange", () => {
  const today = "2026-10-21";

  it("defaults to this month", () => {
    expect(parseRange(undefined, today)).toMatchObject({ preset: "this_month", from: "2026-10-01", to: "2026-10-31", label: "Oct 2026" });
    expect(parseRange("nonsense", today, "quarter").preset).toBe("quarter");
  });

  it("handles last month across a year boundary", () => {
    expect(parseRange("last_month", "2026-01-15")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(parseRange("last_month", "2028-03-31")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("uses calendar quarters labelled with India's financial year", () => {
    expect(parseRange("quarter", today)).toMatchObject({ from: "2026-10-01", to: "2026-12-31", label: "Q3 FY27 (Oct–Dec 2026)" });
    expect(parseRange("quarter", "2027-02-01")).toMatchObject({ from: "2027-01-01", to: "2027-03-31", label: "Q4 FY27 (Jan–Mar 2027)" });
    expect(parseRange("quarter", "2026-04-01").label).toBe("Q1 FY27 (Apr–Jun 2026)");
  });

  it("reads custom ranges, swapping reversed ends and rejecting impossible days", () => {
    expect(parseRange("2026-07-01_2026-09-30", today)).toMatchObject({ preset: "custom", from: "2026-07-01", to: "2026-09-30" });
    expect(parseRange("2026-09-30_2026-07-01", today)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(parseRange("2026-02-30_2026-03-01", today).preset).toBe("this_month");
  });

  it("round-trips through the URL value", () => {
    const custom = parseRange("2026-07-01_2026-09-30", today);
    expect(rangeParam(custom)).toBe("2026-07-01_2026-09-30");
    expect(rangeParam(parseRange("last_month", today))).toBe("last_month");
  });
});

describe("range helpers", () => {
  it("is inclusive at both ends", () => {
    const r = { from: "2026-10-01", to: "2026-10-31" };
    expect(inRange("2026-10-01", r)).toBe(true);
    expect(inRange("2026-10-31", r)).toBe(true);
    expect(inRange("2026-11-01", r)).toBe(false);
    expect(inRange(null, r)).toBe(false);
  });

  it("lists every month touched", () => {
    expect(monthsIn({ from: "2026-11-15", to: "2027-02-01" })).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("counts days and reads today in IST", () => {
    expect(daysBetween("2026-09-10", "2026-10-20")).toBe(40);
    // 20:00 UTC on 21 Oct is already 22 Oct in India.
    expect(todayIst(new Date("2026-10-21T20:00:00Z"))).toBe("2026-10-22");
  });
});
