/** Pure aggregation for Reports v1. src/server/reports.ts fetches raw rows; everything that turns
 *  them into report numbers lives here so it can be unit-tested without a database. */
import { daysBetween, inRange, monthOf, monthsIn, type DateRange } from "./range";

export const DEAL_TYPES = ["new_business", "upsell", "cross_sell", "renewal", "addendum"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const NO_OWNER = "Unassigned";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Group rows by a key, keeping first-seen order. */
export function groupBy<T>(rows: T[], key: (r: T) => string) {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const sum = <T>(rows: T[], value: (r: T) => number) => round2(rows.reduce((a, r) => a + value(r), 0));

const byTotalDesc = <T extends { total: number; name: string }>(a: T, b: T) => b.total - a.total || a.name.localeCompare(b.name);

// ---------- 1. MRR booked ----------

export type WonDealRow = {
  id: string;
  title: string;
  orgName: string;
  ownerName: string | null;
  type: DealType;
  mrr: number;
  oneTimeFee: number;
  currency: "INR" | "USD";
  /** IST day the deal was won (deals.closed_at). */
  closedOn: string;
};

export type BookedLine = { name: string; count: number; oneTime: number; total: number } & Record<DealType, number>;

function bookedLine(name: string, rows: WonDealRow[]): BookedLine {
  const byType = Object.fromEntries(DEAL_TYPES.map((t) => [t, sum(rows.filter((r) => r.type === t), (r) => r.mrr)])) as Record<DealType, number>;
  return { name, count: rows.length, ...byType, oneTime: sum(rows, (r) => r.oneTimeFee), total: sum(rows, (r) => r.mrr) };
}

/** Won-deal MRR in the range, split by deal type, by month (every month in the range) and by AE. */
export function mrrBooked(all: WonDealRow[], range: Pick<DateRange, "from" | "to">) {
  const rows = all.filter((r) => inRange(r.closedOn, range));
  const months = groupBy(rows, (r) => monthOf(r.closedOn));
  return {
    rows,
    totals: bookedLine("Total", rows),
    byMonth: monthsIn(range).map((m) => bookedLine(m, months.get(m) ?? [])),
    byOwner: [...groupBy(rows, (r) => r.ownerName ?? NO_OWNER)].map(([name, list]) => bookedLine(name, list)).sort(byTotalDesc),
    /** Deal types with any booking, so tables and charts can drop empty columns. */
    types: DEAL_TYPES.filter((t) => rows.some((r) => r.type === t)),
    usdDeals: rows.filter((r) => r.currency !== "INR").length,
  };
}

// ---------- 2. Pipeline & forecast ----------

export type OpenDealRow = {
  id: string;
  title: string;
  orgName: string;
  ownerName: string | null;
  stageKey: string;
  stageName: string;
  stagePosition: number;
  winProbability: number | null;
  mrr: number;
  oneTimeFee: number;
  expectedCloseDate: string | null;
};

export type PipelineStage = { key: string; name: string; position: number; winProbability: number | null };

export const COMMIT_FROM_STAGE = "commercial_discussion";

export const weightedMrr = (r: Pick<OpenDealRow, "mrr" | "winProbability">) => round2((r.mrr * (r.winProbability ?? 0)) / 100);

/**
 * Open pipeline (all open deals) by stage and AE, and the forecast for the range:
 * "closing" = expected to close in the range; "commit" = closing and at Commercial Discussion or later.
 */
export function pipelineForecast(all: OpenDealRow[], stages: PipelineStage[], range: Pick<DateRange, "from" | "to">) {
  const commitPosition = stages.find((s) => s.key === COMMIT_FROM_STAGE)?.position ?? Infinity;
  const isClosing = (r: OpenDealRow) => inRange(r.expectedCloseDate, range);
  const isCommit = (r: OpenDealRow) => isClosing(r) && r.stagePosition >= commitPosition;
  const line = (name: string, rows: OpenDealRow[]) => ({
    name,
    count: rows.length,
    total: sum(rows, (r) => r.mrr),
    weighted: sum(rows, weightedMrr),
    oneTime: sum(rows, (r) => r.oneTimeFee),
    closing: sum(rows.filter(isClosing), (r) => r.mrr),
    commit: sum(rows.filter(isCommit), (r) => r.mrr),
  });
  const byStageKey = groupBy(all, (r) => r.stageKey);
  return {
    rows: all,
    totals: line("Total", all),
    byStage: stages.map((s) => ({ ...line(s.name, byStageKey.get(s.key) ?? []), winProbability: s.winProbability })),
    byOwner: [...groupBy(all, (r) => r.ownerName ?? NO_OWNER)].map(([name, list]) => line(name, list)).sort(byTotalDesc),
    commitDeals: all.filter(isCommit).sort((a, b) => b.mrr - a.mrr),
    noCloseDate: all.filter((r) => !r.expectedCloseDate).length,
    isCommit,
    isClosing,
  };
}

// ---------- 4. Customer book ----------

export type BookOrgRow = {
  id: string;
  name: string;
  lifecycle: "onboarding" | "active" | "on_hold";
  segment: string | null;
  health: "green" | "yellow" | "red" | null;
  csmName: string | null;
  contractedMrr: number;
};

export type ChurnRow = {
  id: string;
  name: string;
  segment: string | null;
  csmName: string | null;
  churnedAt: string;
  category: string | null;
  /** MRR of the contracts the churn ended. */
  churnedMrr: number;
};

export const BOOK_LIFECYCLES = ["active", "onboarding", "on_hold"] as const;
export const HEALTHS = ["green", "yellow", "red", "none"] as const;

/** The live book (no date range: it's today's customers) by lifecycle, CSM, segment and health. */
export function customerBook(rows: BookOrgRow[]) {
  const line = (name: string, list: BookOrgRow[]) => ({
    name,
    count: list.length,
    total: sum(list, (r) => r.contractedMrr),
    ...(Object.fromEntries(HEALTHS.map((h) => [h, sum(list.filter((r) => (r.health ?? "none") === h), (r) => r.contractedMrr)])) as Record<
      (typeof HEALTHS)[number],
      number
    >),
  });
  return {
    rows,
    totals: line("Total", rows),
    byLifecycle: BOOK_LIFECYCLES.map((l) => line(l, rows.filter((r) => r.lifecycle === l))),
    byCsm: [...groupBy(rows, (r) => r.csmName ?? NO_OWNER)].map(([name, list]) => line(name, list)).sort(byTotalDesc),
    bySegment: [...groupBy(rows, (r) => r.segment ?? "none")].map(([name, list]) => line(name, list)).sort(byTotalDesc),
    byHealth: HEALTHS.map((h) => ({ health: h, count: rows.filter((r) => (r.health ?? "none") === h).length })),
  };
}

/** Churn in the range by month and category. */
export function churnSummary(all: ChurnRow[], range: Pick<DateRange, "from" | "to">) {
  const rows = all.filter((r) => inRange(r.churnedAt, range));
  const months = groupBy(rows, (r) => monthOf(r.churnedAt));
  const line = (name: string, list: ChurnRow[]) => ({ name, count: list.length, total: sum(list, (r) => r.churnedMrr) });
  return {
    rows,
    totals: line("Total", rows),
    byMonth: monthsIn(range).map((m) => line(m, months.get(m) ?? [])),
    byCategory: [...groupBy(rows, (r) => r.category ?? "none")].map(([name, list]) => line(name, list)).sort(byTotalDesc),
  };
}

// ---------- 5. Onboarding throughput ----------

export type OnboardingRow = {
  id: string;
  orgName: string;
  omName: string | null;
  stageName: string;
  /** IST day the onboarding was opened (its `created` event). */
  openedOn: string;
  /** Kick-off: onboardings.kickoff_date, else the day it entered Implementation. */
  kickoffOn: string | null;
  /** IST day it entered Handed to CS (from events). */
  handedOn: string | null;
};

export const kickoffToHandover = (r: Pick<OnboardingRow, "kickoffOn" | "handedOn">) =>
  r.kickoffOn && r.handedOn ? Math.max(daysBetween(r.kickoffOn, r.handedOn), 0) : null;

const average = (ns: number[]) => (ns.length ? Math.round((ns.reduce((a, n) => a + n, 0) / ns.length) * 10) / 10 : null);

/** Onboardings opened and handed to CS in the range, and average days from kick-off to handover. */
export function onboardingThroughput(all: OnboardingRow[], range: Pick<DateRange, "from" | "to">) {
  const opened = all.filter((r) => inRange(r.openedOn, range));
  const handed = all.filter((r) => inRange(r.handedOn, range));
  const line = (name: string, o: OnboardingRow[], h: OnboardingRow[]) => {
    const days = h.map(kickoffToHandover).filter((d): d is number => d !== null);
    return { name, opened: o.length, handed: h.length, avgDays: average(days), timed: days.length };
  };
  const openedByMonth = groupBy(opened, (r) => monthOf(r.openedOn));
  const handedByMonth = groupBy(handed, (r) => monthOf(r.handedOn!));
  const oms = [...new Set([...opened, ...handed].map((r) => r.omName ?? NO_OWNER))].sort();
  return {
    totals: line("Total", opened, handed),
    byMonth: monthsIn(range).map((m) => line(m, openedByMonth.get(m) ?? [], handedByMonth.get(m) ?? [])),
    byOm: oms.map((om) =>
      line(
        om,
        opened.filter((r) => (r.omName ?? NO_OWNER) === om),
        handed.filter((r) => (r.omName ?? NO_OWNER) === om),
      ),
    ),
    rows: all.filter((r) => inRange(r.openedOn, range) || inRange(r.handedOn, range)),
  };
}

// ---------- CSV ----------

export type CsvValue = string | number | null | undefined;

const csvCell = (v: CsvValue) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote anything with a delimiter, quote or newline; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** RFC 4180 CSV with CRLF line endings. */
export const toCsv = (header: string[], rows: CsvValue[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
