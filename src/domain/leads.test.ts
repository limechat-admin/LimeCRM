import { describe, expect, it } from "vitest";
import { bantTotal, dealStageForLead, leadStatusMissing, qualificationFor } from "./leads";

const lead = (over: Partial<Parameters<typeof leadStatusMissing>[0]> = {}): Parameters<typeof leadStatusMissing>[0] => ({
  orgId: "org-1",
  ownerId: "ae-1",
  productInterest: ["Voice BOT"],
  meetingScheduledAt: "2026-10-21",
  meetingCompletedAt: "2026-10-22",
  disqualifiedReason: null,
  bantBudget: 20,
  bantAuthority: 20,
  bantNeed: 20,
  bantTimeline: 20,
  ...over,
});

describe("bantTotal", () => {
  it("sums the four scores", () => {
    expect(bantTotal(lead())).toBe(80);
  });
  it("is null until every part is scored (0 counts as scored)", () => {
    expect(bantTotal(lead({ bantNeed: null }))).toBeNull();
    expect(bantTotal(lead({ bantNeed: 0 }))).toBe(60);
  });
});

describe("qualificationFor", () => {
  it("applies the SOP thresholds: <50 meeting only, 50–74 qualified, 75+ SQL", () => {
    expect(qualificationFor(null)).toBe("meeting_completed");
    expect(qualificationFor(49)).toBe("meeting_completed");
    expect(qualificationFor(50)).toBe("qualified_meeting");
    expect(qualificationFor(74)).toBe("qualified_meeting");
    expect(qualificationFor(75)).toBe("sql");
  });
});

describe("leadStatusMissing", () => {
  it("lets a fully qualified lead become an SQL", () => {
    expect(leadStatusMissing(lead(), "sql")).toEqual([]);
  });

  it("blocks SQL below the 75 threshold and says the current score", () => {
    const missing = leadStatusMissing(lead({ bantTimeline: 5 }), "sql");
    expect(missing.map((m) => m.label)).toEqual(["BANT score of at least 75 (now 65)"]);
    expect(leadStatusMissing(lead({ bantTimeline: 5 }), "qualified_meeting")).toEqual([]);
  });

  it("requires the AE, product interest, company and full BANT to qualify", () => {
    const missing = leadStatusMissing(
      lead({ ownerId: null, productInterest: [], orgId: null, bantBudget: null }),
      "qualified_meeting",
    );
    expect(missing.map((m) => m.key)).toEqual(["lead.org", "lead.owner", "lead.product_interest", "lead.bant"]);
  });

  it("needs a reason to disqualify and a date for meetings", () => {
    expect(leadStatusMissing(lead({ disqualifiedReason: "  " }), "disqualified").map((m) => m.key)).toEqual([
      "lead.disqualified_reason",
    ]);
    expect(leadStatusMissing(lead({ meetingScheduledAt: null }), "meeting_scheduled").map((m) => m.key)).toEqual([
      "lead.meeting_scheduled_at",
    ]);
  });

  it("has no requirements for early working statuses", () => {
    expect(leadStatusMissing(lead({ ownerId: null, bantNeed: null }), "attempted_contact")).toEqual([]);
  });
});

describe("dealStageForLead", () => {
  it("creates deals only for qualified meetings and SQLs", () => {
    expect(dealStageForLead("qualified_meeting")).toBe("qualified_meeting");
    expect(dealStageForLead("sql")).toBe("sql");
    expect(dealStageForLead("meeting_completed")).toBeNull();
    expect(dealStageForLead("disqualified")).toBeNull();
  });
});
