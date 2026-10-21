/**
 * CRM hygiene: how clean each person's records are. 5% of AE variable pay is linked to it (Sales
 * plan), and the SOPs ask for the same things the stage gates check, so the score is built from
 * those rules rather than a separate checklist. Pure, so the scoring is unit-tested.
 */
import { isStale, istDay } from "./work";

export type DealCheckKey = "stage_fields" | "close_date" | "fresh" | "next_step" | "contact";
export type LeadCheckKey = "status_fields" | "fresh";

export const DEAL_CHECKS: { key: DealCheckKey; label: string; help: string }[] = [
  { key: "stage_fields", label: "Stage fields", help: "Everything the current stage requires is filled in (the stage gate)" },
  { key: "close_date", label: "Close date", help: "Open deals have an expected close date that isn't in the past" },
  { key: "fresh", label: "Touched", help: "Open deals were updated or had an activity in the last 14 days" },
  { key: "next_step", label: "Next step", help: "Open deals have an open task or follow-up" },
  { key: "contact", label: "Contact", help: "Open and won deals name a primary contact" },
];

export const LEAD_CHECKS: { key: LeadCheckKey; label: string; help: string }[] = [
  { key: "status_fields", label: "Status fields", help: "What the SDR SOP requires for the lead's status is filled in (meeting dates, BANT, AE, reason)" },
  { key: "fresh", label: "Touched", help: "Leads still being worked were updated or had an activity in the last 14 days" },
];

export type DealHygieneInput = {
  id: string;
  title: string;
  orgName: string;
  ownerId: string | null;
  ownerName: string | null;
  status: "open" | "won" | "lost";
  /** Labels of the current stage's required fields that are empty. */
  stageMissing: string[];
  expectedCloseDate: string | null;
  primaryContactId: string | null;
  lastTouchAt: Date | null;
  hasOpenTask: boolean;
};

export type LeadHygieneInput = {
  id: string;
  name: string;
  orgName: string | null;
  sdrId: string | null;
  sdrName: string | null;
  /** open / hold / won / lost, from the lead status. */
  kind: string;
  statusMissing: string[];
  lastTouchAt: Date | null;
};

export type CheckResult<K extends string> = { key: K; ok: boolean; problem: string };

export function dealChecks(d: DealHygieneInput, now: Date): CheckResult<DealCheckKey>[] {
  const out: CheckResult<DealCheckKey>[] = [
    { key: "stage_fields", ok: d.stageMissing.length === 0, problem: `Missing ${d.stageMissing.join(", ")}` },
  ];
  if (d.status === "open") {
    const today = istDay(now);
    out.push(
      {
        key: "close_date",
        ok: !!d.expectedCloseDate && d.expectedCloseDate >= today,
        problem: d.expectedCloseDate ? `Close date ${d.expectedCloseDate} has passed` : "No expected close date",
      },
      { key: "fresh", ok: !isStale(d.lastTouchAt, now), problem: "No touch in 14+ days" },
      { key: "next_step", ok: d.hasOpenTask, problem: "No next step" },
    );
  }
  if (d.status !== "lost") out.push({ key: "contact", ok: !!d.primaryContactId, problem: "No primary contact" });
  return out;
}

export function leadChecks(l: LeadHygieneInput, now: Date): CheckResult<LeadCheckKey>[] {
  const out: CheckResult<LeadCheckKey>[] = [{ key: "status_fields", ok: l.statusMissing.length === 0, problem: `Missing ${l.statusMissing.join(", ")}` }];
  if (l.kind === "open" || l.kind === "hold") out.push({ key: "fresh", ok: !isStale(l.lastTouchAt, now), problem: "No touch in 14+ days" });
  return out;
}

export type Tally = { passed: number; total: number };
const ratio = (t: Tally) => (t.total ? t.passed / t.total : null);

export type PersonScore<K extends string> = {
  personId: string | null;
  name: string;
  records: number;
  /** Share of checks passed, 0–1; null with nothing to check. */
  score: number | null;
  byCheck: Record<K, Tally>;
  failing: { id: string; title: string; orgName: string | null; person: string; problems: string[] }[];
};

export const NO_OWNER_LABEL = "Unassigned";

/** Score each person: passed checks over applicable checks, plus the records to fix, worst first. */
export function scoreByPerson<R, K extends string>(
  records: R[],
  keys: K[],
  person: (r: R) => { id: string | null; name: string | null },
  checks: (r: R) => CheckResult<K>[],
  describe: (r: R) => { id: string; title: string; orgName: string | null },
): { people: PersonScore<K>[]; team: PersonScore<K> } {
  const blank = (): Record<K, Tally> => Object.fromEntries(keys.map((k) => [k, { passed: 0, total: 0 }])) as Record<K, Tally>;
  const byPerson = new Map<string, PersonScore<K>>();
  const team: PersonScore<K> = { personId: null, name: "Team", records: 0, score: null, byCheck: blank(), failing: [] };
  for (const r of records) {
    const p = person(r);
    const key = p.id ?? "";
    let row = byPerson.get(key);
    if (!row) byPerson.set(key, (row = { personId: p.id, name: p.name ?? NO_OWNER_LABEL, records: 0, score: null, byCheck: blank(), failing: [] }));
    const results = checks(r);
    row.records++;
    team.records++;
    for (const c of results) {
      for (const t of [row.byCheck[c.key], team.byCheck[c.key]]) {
        t.total++;
        if (c.ok) t.passed++;
      }
    }
    const problems = results.filter((c) => !c.ok).map((c) => c.problem);
    if (problems.length) {
      const item = { ...describe(r), person: row.name, problems };
      row.failing.push(item);
      team.failing.push(item);
    }
  }
  const finish = (row: PersonScore<K>) => {
    const sum = Object.values<Tally>(row.byCheck).reduce((a, t) => ({ passed: a.passed + t.passed, total: a.total + t.total }), { passed: 0, total: 0 });
    row.score = ratio(sum);
    row.failing.sort((a, b) => b.problems.length - a.problems.length || a.title.localeCompare(b.title));
    return row;
  };
  const people = [...byPerson.values()].map(finish).sort((a, b) => (a.score ?? 2) - (b.score ?? 2) || a.name.localeCompare(b.name));
  return { people, team: finish(team) };
}

