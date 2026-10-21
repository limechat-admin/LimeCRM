import { describe, expect, it } from "vitest";
import { dealChecks, leadChecks, scoreByPerson, type DealHygieneInput, type DealCheckKey } from "./hygiene";

const now = new Date("2026-10-22T06:00:00Z");
const clean: DealHygieneInput = {
  id: "d1",
  title: "Acme - Chat",
  orgName: "Acme",
  ownerId: "u1",
  ownerName: "Asha",
  status: "open",
  stageMissing: [],
  expectedCloseDate: "2026-11-30",
  primaryContactId: "c1",
  lastTouchAt: new Date("2026-10-20T06:00:00Z"),
  hasOpenTask: true,
};

describe("dealChecks", () => {
  it("passes a clean open deal on all five", () => {
    const r = dealChecks(clean, now);
    expect(r.map((c) => c.key)).toEqual(["stage_fields", "close_date", "fresh", "next_step", "contact"]);
    expect(r.every((c) => c.ok)).toBe(true);
  });
  it("flags what a messy open deal is missing", () => {
    const r = dealChecks({ ...clean, stageMissing: ["Plan", "Priority"], expectedCloseDate: "2026-10-01", primaryContactId: null, lastTouchAt: null, hasOpenTask: false }, now);
    expect(r.filter((c) => !c.ok).map((c) => c.problem)).toEqual([
      "Missing Plan, Priority",
      "Close date 2026-10-01 has passed",
      "No touch in 14+ days",
      "No next step",
      "No primary contact",
    ]);
  });
  it("checks only stage fields and contact on won deals, and only stage fields on lost ones", () => {
    expect(dealChecks({ ...clean, status: "won", expectedCloseDate: null }, now).map((c) => c.key)).toEqual(["stage_fields", "contact"]);
    expect(dealChecks({ ...clean, status: "lost", primaryContactId: null }, now).map((c) => c.key)).toEqual(["stage_fields"]);
  });
});

describe("leadChecks", () => {
  it("checks freshness only while a lead is being worked", () => {
    const base = { id: "l1", name: "Ravi", orgName: null, sdrId: "s1", sdrName: "Vishnu", statusMissing: [], lastTouchAt: null };
    expect(leadChecks({ ...base, kind: "open" }, now).map((c) => [c.key, c.ok])).toEqual([
      ["status_fields", true],
      ["fresh", false],
    ]);
    expect(leadChecks({ ...base, kind: "won" }, now).map((c) => c.key)).toEqual(["status_fields"]);
  });
});

describe("scoreByPerson", () => {
  it("scores passed over applicable checks per person, worst first, with a team total", () => {
    const keys: DealCheckKey[] = ["stage_fields", "close_date", "fresh", "next_step", "contact"];
    const deals: DealHygieneInput[] = [
      clean,
      { ...clean, id: "d2", title: "Beta - Voice", stageMissing: ["Plan"] },
      { ...clean, id: "d3", ownerId: "u2", ownerName: "Ravi", status: "won", primaryContactId: null },
      { ...clean, id: "d4", ownerId: null, ownerName: null, status: "lost" },
    ];
    const { people, team } = scoreByPerson(
      deals,
      keys,
      (d) => ({ id: d.ownerId, name: d.ownerName }),
      (d) => dealChecks(d, now),
      (d) => ({ id: d.id, title: d.title, orgName: d.orgName }),
    );
    expect(people.map((p) => [p.name, p.score])).toEqual([
      ["Ravi", 0.5],
      ["Asha", 0.9],
      ["Unassigned", 1],
    ]);
    expect(people[1].byCheck.stage_fields).toEqual({ passed: 1, total: 2 });
    expect(people[1].failing).toEqual([{ id: "d2", title: "Beta - Voice", orgName: "Acme", person: "Asha", problems: ["Missing Plan"] }]);
    expect(team.records).toBe(4);
    expect(team.score).toBeCloseTo(11 / 13);
  });
});
