import { describe, expect, it } from "vitest";
import {
  churnSummary,
  customerBook,
  kickoffToHandover,
  mrrBooked,
  onboardingThroughput,
  pipelineForecast,
  sdrFunnel,
  toCsv,
  type BookOrgRow,
  type LeadRow,
  type OnboardingRow,
  type OpenDealRow,
  type PipelineStage,
  type WonDealRow,
} from "./aggregate";

const q3 = { from: "2026-07-01", to: "2026-09-30" };

const won = (p: Partial<WonDealRow>): WonDealRow => ({
  id: crypto.randomUUID(),
  title: "Deal",
  orgName: "Org",
  ownerName: "Riya",
  type: "new_business",
  mrr: 0,
  oneTimeFee: 0,
  currency: "INR",
  closedOn: "2026-07-10",
  ...p,
});

describe("mrrBooked", () => {
  const rows = [
    won({ mrr: 10000, oneTimeFee: 5000, closedOn: "2026-07-01" }),
    won({ mrr: 2500.5, type: "upsell", closedOn: "2026-09-30" }),
    won({ mrr: 4000, type: "renewal", ownerName: null, closedOn: "2026-08-15" }),
    won({ mrr: 99999, closedOn: "2026-10-01" }), // outside the range
  ];
  const r = mrrBooked(rows, q3);

  it("totals MRR and one-time revenue for deals won in the range", () => {
    expect(r.totals).toMatchObject({ count: 3, total: 16500.5, oneTime: 5000, new_business: 10000, upsell: 2500.5, renewal: 4000, cross_sell: 0 });
    expect(r.types).toEqual(["new_business", "upsell", "renewal"]);
  });

  it("has a line for every month, including empty ones", () => {
    expect(r.byMonth.map((m) => [m.name, m.total])).toEqual([
      ["2026-07", 10000],
      ["2026-08", 4000],
      ["2026-09", 2500.5],
    ]);
  });

  it("groups by AE, largest first, with deals that have no AE as Unassigned", () => {
    expect(r.byOwner.map((o) => [o.name, o.total, o.count])).toEqual([
      ["Riya", 12500.5, 2],
      ["Unassigned", 4000, 1],
    ]);
  });
});

describe("pipelineForecast", () => {
  const stages: PipelineStage[] = [
    { key: "sql", name: "SQL", position: 2, winProbability: 20 },
    { key: "commercial_discussion", name: "Commercial", position: 4, winProbability: 70 },
    { key: "agreement_sent", name: "Agreement Sent", position: 5, winProbability: 80 },
  ];
  const deal = (p: Partial<OpenDealRow>): OpenDealRow => ({
    id: crypto.randomUUID(),
    title: "Deal",
    orgName: "Org",
    ownerName: "Arjun",
    stageKey: "sql",
    stageName: "SQL",
    stagePosition: 2,
    winProbability: 20,
    mrr: 0,
    oneTimeFee: 0,
    expectedCloseDate: null,
    ...p,
  });
  const oct = { from: "2026-10-01", to: "2026-10-31" };
  const rows = [
    deal({ mrr: 10000, expectedCloseDate: "2026-10-15" }), // closing, but too early a stage for commit
    deal({ mrr: 20000, stageKey: "commercial_discussion", stagePosition: 4, winProbability: 70, expectedCloseDate: "2026-10-31" }),
    deal({ mrr: 5000, stageKey: "agreement_sent", stagePosition: 5, winProbability: 80, expectedCloseDate: "2026-11-02", ownerName: "Riya" }),
  ];
  const r = pipelineForecast(rows, stages, oct);

  it("weights open MRR by stage win probability", () => {
    expect(r.totals).toMatchObject({ count: 3, total: 35000, weighted: 2000 + 14000 + 4000 });
  });

  it("commits deals closing in the range at Commercial Discussion or later", () => {
    expect(r.totals.closing).toBe(30000);
    expect(r.totals.commit).toBe(20000);
    expect(r.commitDeals).toHaveLength(1);
  });

  it("lists every stage, including empty ones, and AEs by open MRR", () => {
    expect(r.byStage.map((s) => [s.name, s.count])).toEqual([
      ["SQL", 1],
      ["Commercial", 1],
      ["Agreement Sent", 1],
    ]);
    expect(r.byOwner.map((o) => [o.name, o.total, o.commit])).toEqual([
      ["Arjun", 30000, 20000],
      ["Riya", 5000, 0],
    ]);
    expect(r.noCloseDate).toBe(0);
  });
});

describe("sdrFunnel", () => {
  const lead = (p: Partial<LeadRow>): LeadRow => ({
    id: crypto.randomUUID(),
    name: "Lead",
    sdrName: "Sana",
    leadStatus: "not_contacted",
    createdOn: "2026-06-01",
    meetingScheduledAt: null,
    meetingCompletedAt: null,
    qualifiedAt: null,
    sqlAt: null,
    wonOn: null,
    wonMrr: 0,
    ...p,
  });
  const rows = [
    lead({ leadStatus: "sql", meetingScheduledAt: "2026-07-02", meetingCompletedAt: "2026-07-05", qualifiedAt: "2026-08-01", sqlAt: "2026-08-01", wonOn: "2026-09-10", wonMrr: 12000 }),
    lead({ leadStatus: "sql", sdrName: null, meetingScheduledAt: "2026-06-20", meetingCompletedAt: "2026-07-01", qualifiedAt: "2026-07-01", sqlAt: "2026-07-01" }),
    lead({ leadStatus: "meeting_scheduled", createdOn: "2026-09-01", meetingScheduledAt: "2026-10-05" }),
  ];
  const r = sdrFunnel(rows, q3);

  it("counts each step on the day it happened", () => {
    expect(r.totals).toEqual({ scheduled: 1, completed: 2, qualified: 2, sqls: 2 });
    expect(r.byMonth.map((m) => [m.name, m.scheduled, m.completed, m.qualified, m.sqls])).toEqual([
      ["2026-07", 1, 2, 1, 1],
      ["2026-08", 0, 0, 1, 1],
      ["2026-09", 0, 0, 0, 0],
    ]);
  });

  it("splits per SDR per month", () => {
    expect(r.bySdrMonth).toEqual([
      { sdr: "Sana", month: "2026-07", scheduled: 1, completed: 1, qualified: 0, sqls: 0 },
      { sdr: "Sana", month: "2026-08", scheduled: 0, completed: 0, qualified: 1, sqls: 1 },
      { sdr: "Unassigned", month: "2026-07", scheduled: 0, completed: 1, qualified: 1, sqls: 1 },
    ]);
  });

  it("follows the range's SQLs to won deals", () => {
    expect(r.conversion).toEqual({ sqls: 2, won: 1, rate: 0.5, wonMrr: 12000 });
  });

  it("buckets leads created in the range by current status", () => {
    expect(r.created).toBe(1);
    expect(r.byStatus).toEqual([{ status: "meeting_scheduled", count: 1 }]);
  });
});

describe("customerBook and churnSummary", () => {
  const org = (p: Partial<BookOrgRow>): BookOrgRow => ({
    id: crypto.randomUUID(),
    name: "Org",
    lifecycle: "active",
    segment: "mid_market",
    health: null,
    csmName: "Meera",
    contractedMrr: 0,
    ...p,
  });
  const book = customerBook([
    org({ contractedMrr: 75000, health: "green", segment: "enterprise" }),
    org({ contractedMrr: 20000, lifecycle: "onboarding", csmName: null }),
    org({ contractedMrr: 5000, lifecycle: "on_hold", health: "red" }),
  ]);

  it("splits contracted MRR by lifecycle, CSM, segment and health", () => {
    expect(book.totals).toMatchObject({ count: 3, total: 100000, green: 75000, red: 5000, none: 20000 });
    expect(book.byLifecycle.map((l) => [l.name, l.count, l.total])).toEqual([
      ["active", 1, 75000],
      ["onboarding", 1, 20000],
      ["on_hold", 1, 5000],
    ]);
    expect(book.byCsm.map((c) => [c.name, c.total])).toEqual([
      ["Meera", 80000],
      ["Unassigned", 20000],
    ]);
    expect(book.bySegment.map((s) => s.name)).toEqual(["enterprise", "mid_market"]);
  });

  it("totals churn in the range by month and category", () => {
    const churn = churnSummary(
      [
        { id: "a", name: "A", segment: null, csmName: null, churnedAt: "2026-07-31", category: "payment", churnedMrr: 10000 },
        { id: "b", name: "B", segment: null, csmName: null, churnedAt: "2026-09-01", category: "payment", churnedMrr: 2000 },
        { id: "c", name: "C", segment: null, csmName: null, churnedAt: "2026-09-02", category: null, churnedMrr: 500 },
        { id: "d", name: "D", segment: null, csmName: null, churnedAt: "2026-10-02", category: "business", churnedMrr: 9 },
      ],
      q3,
    );
    expect(churn.totals).toMatchObject({ count: 3, total: 12500 });
    expect(churn.byMonth.map((m) => [m.name, m.count])).toEqual([
      ["2026-07", 1],
      ["2026-08", 0],
      ["2026-09", 2],
    ]);
    expect(churn.byCategory.map((c) => [c.name, c.count, c.total])).toEqual([
      ["payment", 2, 12000],
      ["none", 1, 500],
    ]);
  });
});

describe("onboardingThroughput", () => {
  const onb = (p: Partial<OnboardingRow>): OnboardingRow => ({
    id: crypto.randomUUID(),
    orgName: "Org",
    omName: "Dev",
    stageName: "Not Started",
    openedOn: "2026-07-01",
    kickoffOn: null,
    handedOn: null,
    ...p,
  });
  const rows = [
    onb({ openedOn: "2026-06-20", kickoffOn: "2026-07-01", handedOn: "2026-08-10" }), // 40 days, opened before the range
    onb({ openedOn: "2026-07-05", kickoffOn: "2026-07-10", handedOn: "2026-07-30" }), // 20 days
    onb({ openedOn: "2026-09-01", omName: null }),
    onb({ openedOn: "2026-08-01", handedOn: "2026-09-01" }), // handed with no kick-off date: not timed
  ];
  const r = onboardingThroughput(rows, q3);

  it("counts opened and handed in the range and averages only timed handovers", () => {
    expect(r.totals).toEqual({ name: "Total", opened: 3, handed: 3, avgDays: 30, timed: 2 });
  });

  it("splits by month and onboarding manager", () => {
    expect(r.byMonth.map((m) => [m.name, m.opened, m.handed])).toEqual([
      ["2026-07", 1, 1],
      ["2026-08", 1, 1],
      ["2026-09", 1, 1],
    ]);
    expect(r.byOm.map((o) => [o.name, o.opened, o.handed])).toEqual([
      ["Dev", 2, 3],
      ["Unassigned", 1, 0],
    ]);
  });

  it("never reports negative durations", () => {
    expect(kickoffToHandover({ kickoffOn: "2026-08-10", handedOn: "2026-08-01" })).toBe(0);
    expect(kickoffToHandover({ kickoffOn: null, handedOn: "2026-08-01" })).toBeNull();
  });
});

describe("toCsv", () => {
  it("quotes delimiters and neutralises formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["=SUM(A1)", -5], [null, 12.5]])).toBe(
      'a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),-5\r\n,12.5',
    );
  });
});
