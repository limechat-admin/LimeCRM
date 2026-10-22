import { describe, expect, it } from "vitest";
import { conversionFunnel, funnelQuery, median, parseFunnelOptions, stepDates, type FunnelLeadRow, type FunnelOptions } from "./funnel";

const q3 = { from: "2026-07-01", to: "2026-09-30" };
const created: FunnelOptions = { cohort: "created", by: "sdr", monthly: false };
const events: FunnelOptions = { cohort: "events", by: "sdr", monthly: false };

const lead = (p: Partial<FunnelLeadRow>): FunnelLeadRow => ({
  id: crypto.randomUUID(),
  sdrName: "Sana",
  aeName: "Riya",
  source: "Inbound",
  segment: "mid_market",
  productInterest: [],
  leadStatus: "not_contacted",
  createdOn: "2026-07-01",
  meetingScheduledAt: null,
  meetingCompletedAt: null,
  qualifiedAt: null,
  sqlAt: null,
  wonOn: null,
  wonDealId: null,
  wonMrr: 0,
  ...p,
});

const counts = (l: { lead: number; scheduled: number; completed: number; qualified: number; sql: number; won: number }) => [
  l.lead,
  l.scheduled,
  l.completed,
  l.qualified,
  l.sql,
  l.won,
];

describe("stepDates", () => {
  it("counts a skipped step as reached, on the next step's date", () => {
    expect(stepDates(lead({ createdOn: "2026-07-01", sqlAt: "2026-07-20" }))).toEqual([
      "2026-07-01",
      "2026-07-20",
      "2026-07-20",
      "2026-07-20",
      "2026-07-20",
      null,
    ]);
    expect(stepDates(lead({ meetingScheduledAt: "2026-07-03", qualifiedAt: "2026-07-09" }))).toEqual([
      "2026-07-01",
      "2026-07-03",
      "2026-07-09",
      "2026-07-09",
      null,
      null,
    ]);
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the two middle values", () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 4])).toBe(4);
    expect(median([1, 2, 4, 10])).toBe(3);
    expect(median([1, 2])).toBe(1.5);
  });
});

describe("conversionFunnel", () => {
  const rows = [
    // Full path, created in July, won in September.
    lead({
      createdOn: "2026-07-01",
      meetingScheduledAt: "2026-07-03",
      meetingCompletedAt: "2026-07-08",
      qualifiedAt: "2026-07-10",
      sqlAt: "2026-07-11",
      wonOn: "2026-09-01",
      wonDealId: "d1",
      wonMrr: 20000,
      leadStatus: "sql",
    }),
    // SQL with no meeting dates (skipped steps), Unassigned SDR, August.
    lead({ sdrName: null, createdOn: "2026-08-05", sqlAt: "2026-08-25", leadStatus: "sql" }),
    // Meeting scheduled only.
    lead({ createdOn: "2026-07-15", meetingScheduledAt: "2026-07-20", leadStatus: "meeting_scheduled" }),
    // Created before the range; SQL and won inside it. Same company deal as lead 1.
    lead({
      createdOn: "2026-06-10",
      meetingScheduledAt: "2026-06-12",
      meetingCompletedAt: "2026-06-20",
      sqlAt: "2026-07-05",
      wonOn: "2026-09-01",
      wonDealId: "d1",
      wonMrr: 20000,
    }),
    // Created inside, but its meeting is after the range.
    lead({ createdOn: "2026-09-28", meetingScheduledAt: "2026-10-02", leadStatus: "meeting_scheduled" }),
  ];

  describe("leads created in the period", () => {
    const r = conversionFunnel(rows, q3, created);

    it("counts each cohort lead at every step it has reached by now", () => {
      expect(r.steps.map((s) => s.count)).toEqual([4, 4, 2, 2, 2, 1]);
      expect(counts(r.totals)).toEqual([4, 4, 2, 2, 2, 1]);
      expect(r.rows).toHaveLength(4);
    });

    it("works out conversion from the previous step and from the top", () => {
      const sql = r.steps.find((s) => s.key === "sql")!;
      expect(sql.fromPrevious).toBe(1);
      expect(sql.fromTop).toBe(0.5);
      const completed = r.steps.find((s) => s.key === "completed")!;
      expect(completed.fromPrevious).toBe(0.5);
      expect(r.steps[0].fromPrevious).toBeNull();
      expect(r.totals.leadToSql).toBe(0.5);
      expect(r.totals.sqlToWon).toBe(0.5);
      expect(r.totals.meetingToSql).toBe(1);
    });

    it("takes medians only where both dates are recorded", () => {
      const days = Object.fromEntries(r.steps.map((s) => [s.key, s.medianDays]));
      // Scheduled: lead 1 (2 days), lead 3 (5 days), lead 5 (4 days); lead 2's meeting is implied.
      expect(days).toEqual({ lead: null, scheduled: 4, completed: 5, qualified: 2, sql: 1, won: 52 });
      // Lead → SQL: lead 1 (10 days) and lead 2 (20 days).
      expect(r.totals.medianLeadToSql).toBe(15);
    });

    it("counts won MRR once per deal", () => {
      expect(r.totals.wonMrr).toBe(20000);
    });

    it("groups by SDR, biggest first", () => {
      expect(r.groups.map((g) => [g.name, ...counts(g)])).toEqual([
        ["Sana", 3, 3, 1, 1, 1, 1],
        ["Unassigned", 1, 1, 1, 1, 1, 0],
      ]);
    });

    it("lists the cohort by current status", () => {
      expect(r.byStatus).toEqual([
        { status: "sql", count: 2 },
        { status: "meeting_scheduled", count: 2 },
      ]);
    });

    it("cuts by cohort month, listing every month in the range", () => {
      const m = conversionFunnel(rows, q3, { ...created, by: "month" });
      expect(m.groups.map((g) => [g.name, g.month, ...counts(g)])).toEqual([
        ["2026-07", null, 2, 2, 1, 1, 1, 1],
        ["2026-08", null, 1, 1, 1, 1, 1, 0],
        ["2026-09", null, 1, 1, 0, 0, 0, 0],
      ]);
    });

    it("splits a cut by month", () => {
      const m = conversionFunnel(rows, q3, { ...created, monthly: true });
      expect(m.groups.map((g) => [g.name, g.month, g.lead])).toEqual([
        ["Sana", "2026-07", 2],
        ["Sana", "2026-09", 1],
        ["Unassigned", "2026-08", 1],
      ]);
    });
  });

  describe("events in the period", () => {
    const r = conversionFunnel(rows, q3, events);

    it("counts each step on the day it happened, whenever the lead was created", () => {
      // Lead 4 was created in June: its SQL (July) and win (September) count, its meeting doesn't.
      // Lead 2's meeting steps are implied on its SQL day; lead 5's meeting is in October.
      expect(counts(r.totals)).toEqual([4, 3, 2, 3, 3, 2]);
      expect(r.rows).toHaveLength(5);
      expect(r.byStatus).toEqual([]);
    });

    it("compares the period's counts, so a step can pass 100%", () => {
      const qualified = r.steps.find((s) => s.key === "qualified")!;
      expect(qualified.fromPrevious).toBe(1.5);
      expect(r.totals.sqlToWon).toBeCloseTo(2 / 3);
      expect(r.totals.wonMrr).toBe(20000);
    });

    it("cuts by the month each step happened", () => {
      const m = conversionFunnel(rows, q3, { ...events, by: "month" });
      expect(m.groups.map((g) => [g.name, ...counts(g)])).toEqual([
        ["2026-07", 2, 2, 1, 2, 2, 0],
        ["2026-08", 1, 1, 1, 1, 1, 0],
        ["2026-09", 1, 0, 0, 0, 0, 2],
      ]);
    });
  });

  it("counts a lead once in each product it's interested in, but once in the total", () => {
    const r = conversionFunnel(
      [
        lead({ productInterest: ["Voice BOT", "WhatsApp BOT"], sqlAt: "2026-07-10" }),
        lead({ productInterest: ["Voice BOT", "Voice BOT"] }),
        lead({ productInterest: [] }),
      ],
      q3,
      { ...created, by: "product" },
    );
    expect(r.totals.lead).toBe(3);
    expect(r.groups.map((g) => [g.name, g.lead, g.sql])).toEqual([
      ["Voice BOT", 2, 1],
      ["WhatsApp BOT", 1, 1],
      ["none", 1, 0],
    ]);
  });

  it("cuts by AE, source and segment, with not-set values grouped", () => {
    const rows = [lead({ aeName: null, source: " ", segment: null }), lead({})];
    expect(conversionFunnel(rows, q3, { ...created, by: "ae" }).groups.map((g) => g.name)).toEqual(["Riya", "Unassigned"]);
    expect(conversionFunnel(rows, q3, { ...created, by: "source" }).groups.map((g) => g.name)).toEqual(["Inbound", "none"]);
    expect(conversionFunnel(rows, q3, { ...created, by: "segment" }).groups.map((g) => g.name)).toEqual(["mid_market", "none"]);
  });

  it("handles no data", () => {
    for (const opts of [created, events]) {
      const r = conversionFunnel([], q3, opts);
      expect(r.steps.map((s) => s.count)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(r.steps.every((s) => s.fromPrevious === null && s.fromTop === null && s.medianDays === null)).toBe(true);
      expect(r.totals).toMatchObject({ wonMrr: 0, leadToSql: null, sqlToWon: null, meetingToSql: null, medianLeadToSql: null });
      expect(r.groups).toEqual([]);
      expect(r.rows).toEqual([]);
    }
    // The month cut still lists the range's months, all zero.
    expect(conversionFunnel([], q3, { ...created, by: "month" }).groups.map((g) => [g.name, g.lead])).toEqual([
      ["2026-07", 0],
      ["2026-08", 0],
      ["2026-09", 0],
    ]);
  });
});

describe("funnel options", () => {
  const parse = (q: string) => parseFunnelOptions((k) => new URLSearchParams(q).get(k));

  it("defaults to the created cohort by SDR", () => {
    expect(parse("")).toEqual({ cohort: "created", by: "sdr", monthly: false });
    expect(parse("funnelCohort=nope&funnelBy=nope")).toEqual({ cohort: "created", by: "sdr", monthly: false });
  });

  it("reads and writes the URL", () => {
    const o = parse("funnelCohort=events&funnelBy=product&funnelMonthly=1");
    expect(o).toEqual({ cohort: "events", by: "product", monthly: true });
    expect(funnelQuery(o)).toBe("funnelCohort=events&funnelBy=product&funnelMonthly=1");
    expect(funnelQuery(parse(""))).toBe("");
  });

  it("ignores the month split when the cut is already month", () => {
    expect(parse("funnelBy=month&funnelMonthly=1").monthly).toBe(false);
  });
});
