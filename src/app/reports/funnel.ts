/** Pure aggregation for the conversion funnel report: Lead created → Meeting scheduled → Meeting
 *  completed → Qualified meeting → SQL → Deal won. src/server/reports.ts fetches one row per lead;
 *  everything here is unit-tested without a database. */
import { groupBy, NO_OWNER } from "./aggregate";
import { daysBetween, inRange, monthOf, monthsIn, type DateRange } from "./range";

export const FUNNEL_STEPS = [
  { key: "lead", label: "Lead created" },
  { key: "scheduled", label: "Meeting scheduled" },
  { key: "completed", label: "Meeting completed" },
  { key: "qualified", label: "Qualified meeting" },
  { key: "sql", label: "SQL" },
  { key: "won", label: "Deal won" },
] as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];
const STEP = Object.fromEntries(FUNNEL_STEPS.map((s, i) => [s.key, i])) as Record<FunnelStepKey, number>;

export const FUNNEL_COHORTS = [
  { value: "created", label: "Leads created in the period" },
  { value: "events", label: "Events in the period" },
] as const;
export type FunnelCohort = (typeof FUNNEL_COHORTS)[number]["value"];

export const FUNNEL_CUTS = [
  { value: "sdr", label: "SDR" },
  { value: "ae", label: "AE" },
  { value: "source", label: "Source" },
  { value: "segment", label: "Segment" },
  { value: "product", label: "Product interest" },
  { value: "month", label: "Month" },
] as const;
export type FunnelCut = (typeof FUNNEL_CUTS)[number]["value"];

/** Cohort mode, the group-by, and whether to split each group by month. */
export type FunnelOptions = { cohort: FunnelCohort; by: FunnelCut; monthly: boolean };

/** URL parameter names, next to the range's `?funnel=`. */
export const FUNNEL_PARAMS = { cohort: "funnelCohort", by: "funnelBy", monthly: "funnelMonthly" } as const;

export function parseFunnelOptions(get: (name: string) => string | null | undefined): FunnelOptions {
  const cohort = get(FUNNEL_PARAMS.cohort);
  const by = get(FUNNEL_PARAMS.by);
  const parsedBy = FUNNEL_CUTS.find((c) => c.value === by)?.value ?? "sdr";
  return {
    cohort: cohort === "events" ? "events" : "created",
    by: parsedBy,
    monthly: parsedBy !== "month" && get(FUNNEL_PARAMS.monthly) === "1",
  };
}

/** The non-default options as query-string pairs, for the CSV link. */
export const funnelQuery = (o: FunnelOptions) =>
  [
    o.cohort !== "created" && `${FUNNEL_PARAMS.cohort}=${o.cohort}`,
    o.by !== "sdr" && `${FUNNEL_PARAMS.by}=${o.by}`,
    o.monthly && `${FUNNEL_PARAMS.monthly}=1`,
  ]
    .filter(Boolean)
    .join("&");

export type FunnelLeadRow = {
  id: string;
  sdrName: string | null;
  aeName: string | null;
  source: string | null;
  segment: string | null;
  productInterest: string[];
  leadStatus: string | null;
  /** IST day the lead was created. */
  createdOn: string;
  meetingScheduledAt: string | null;
  meetingCompletedAt: string | null;
  qualifiedAt: string | null;
  sqlAt: string | null;
  /** IST day of the company's first deal won on or after sql_at, if any. */
  wonOn: string | null;
  /** That deal, so two leads at one company don't count its MRR twice. */
  wonDealId: string | null;
  wonMrr: number;
};

/** The dates recorded for each step, in step order (Lead created is always recorded). */
const recorded = (r: FunnelLeadRow) => [r.createdOn, r.meetingScheduledAt, r.meetingCompletedAt, r.qualifiedAt, r.sqlAt, r.wonOn];

/**
 * The day each step was reached, or null if it wasn't. A lead that reached a later step counts as
 * having reached every earlier one: an SQL with no meeting dates still had a meeting. A step with
 * no date of its own takes the date of the next step reached.
 */
export function stepDates(r: FunnelLeadRow): (string | null)[] {
  const out = recorded(r);
  for (let i = out.length - 2; i >= 1; i--) out[i] ??= out[i + 1];
  return out;
}

/** Days into each step from the one before, only where both dates are recorded (never negative). */
function stepDays(r: FunnelLeadRow): (number | null)[] {
  const own = recorded(r);
  return own.map((day, i) => (i > 0 && day && own[i - 1] ? Math.max(daysBetween(own[i - 1]!, day), 0) : null));
}

export function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/** Not-set groups (Unassigned, no source…) sort last. */
const notSet = (l: { name: string }) => (l.name === NONE || l.name === NO_OWNER ? 1 : 0);

const rate = (n: number, of: number) => (of ? n / of : null);

/** Group keys for a lead. A lead interested in several products counts once in each. */
function groupKeys(r: FunnelLeadRow, by: Exclude<FunnelCut, "month">): string[] {
  if (by === "sdr") return [r.sdrName ?? NO_OWNER];
  if (by === "ae") return [r.aeName ?? NO_OWNER];
  if (by === "source") return [r.source?.trim() || NONE];
  if (by === "segment") return [r.segment ?? NONE];
  const products = [...new Set(r.productInterest.map((p) => p.trim()).filter(Boolean))];
  return products.length ? products : [NONE];
}

/** The group key for "not set" (no source, segment or product). */
export const NONE = "none";

type Acc = { counts: number[]; days: number[][]; leadToSql: number[]; wonDeals: Map<string, number> };
const blankAcc = (): Acc => ({ counts: FUNNEL_STEPS.map(() => 0), days: FUNNEL_STEPS.map(() => []), leadToSql: [], wonDeals: new Map() });

export type FunnelStep = { key: FunnelStepKey; label: string; count: number; fromPrevious: number | null; fromTop: number | null; medianDays: number | null };

export type FunnelLine = {
  /** Group key (SDR or AE name, source, segment or product key, or `YYYY-MM` for the month cut). */
  name: string;
  /** `YYYY-MM` when the groups are split by month. */
  month: string | null;
} & Record<FunnelStepKey, number> & {
    wonMrr: number;
    meetingToSql: number | null;
    sqlToWon: number | null;
    leadToSql: number | null;
    medianLeadToSql: number | null;
  };

function line(name: string, month: string | null, a: Acc): FunnelLine {
  const [lead, scheduled, completed, qualified, sql, won] = a.counts;
  return {
    name,
    month,
    lead,
    scheduled,
    completed,
    qualified,
    sql,
    won,
    wonMrr: Math.round([...a.wonDeals.values()].reduce((s, n) => s + n, 0) * 100) / 100,
    meetingToSql: rate(sql, completed),
    sqlToWon: rate(won, sql),
    leadToSql: rate(sql, lead),
    medianLeadToSql: median(a.leadToSql),
  };
}

/**
 * The funnel for a range.
 * - `created`: the leads created in the range, and how far each has got by now.
 * - `events`: how many leads reached each step during the range, whenever they were created.
 *   Conversions compare those counts, so they can pass 100% when last period's leads convert now.
 * Group rows are cut by SDR, AE, source, segment, product interest or month (the cohort month, or
 * in `events` mode the month each step happened), optionally split by month.
 */
export function conversionFunnel(all: FunnelLeadRow[], range: Pick<DateRange, "from" | "to">, opts: FunnelOptions) {
  const total = blankAcc();
  const groups = new Map<string, Acc>();
  const rows: FunnelLeadRow[] = [];
  const byMonth = opts.by === "month" || opts.monthly;
  if (opts.by === "month") for (const m of monthsIn(range)) groups.set(`${m}\u0000`, blankAcc());

  for (const r of all) {
    const dates = stepDates(r);
    const days = stepDays(r);
    const keys = opts.by === "month" ? [""] : groupKeys(r, opts.by);
    let counted = false;
    dates.forEach((reached, i) => {
      if (!reached) return;
      // The day that puts this step in the period (and in a month).
      const day = opts.cohort === "created" ? r.createdOn : reached;
      if (!inRange(day, range)) return;
      counted = true;
      const month = byMonth ? monthOf(day) : "";
      const cells = [total, ...keys.map((k) => {
        const id = opts.by === "month" ? `${month}\u0000` : `${k}\u0000${month}`;
        const cell = groups.get(id) ?? blankAcc();
        groups.set(id, cell);
        return cell;
      })];
      for (const a of cells) {
        a.counts[i]++;
        if (days[i] !== null) a.days[i].push(days[i]!);
        if (i === STEP.sql && r.sqlAt) a.leadToSql.push(Math.max(daysBetween(r.createdOn, r.sqlAt), 0));
        if (i === STEP.won) a.wonDeals.set(r.wonDealId ?? r.id, r.wonMrr);
      }
    });
    if (counted) rows.push(r);
  }

  const totals = line("Total", null, total);
  const steps: FunnelStep[] = FUNNEL_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    count: total.counts[i],
    fromPrevious: i === 0 ? null : rate(total.counts[i], total.counts[i - 1]),
    fromTop: i === 0 ? null : rate(total.counts[i], total.counts[0]),
    medianDays: i === 0 ? null : median(total.days[i]),
  }));
  const lines = [...groups].map(([id, a]) => {
    const [key, month] = id.split("\u0000");
    return line(key, opts.by === "month" ? null : month || null, a);
  });
  lines.sort((a, b) =>
    opts.by === "month"
      ? a.name.localeCompare(b.name)
      : opts.monthly
        ? notSet(a) - notSet(b) || a.name.localeCompare(b.name) || a.month!.localeCompare(b.month!)
        : notSet(a) - notSet(b) || b.lead - a.lead || b.sql - a.sql || a.name.localeCompare(b.name),
  );
  return {
    options: opts,
    steps,
    totals,
    groups: lines,
    /** Leads in the cohort by their current status (`created` mode only). */
    byStatus:
      opts.cohort === "created"
        ? [...groupBy(rows, (r) => r.leadStatus ?? NONE)].map(([status, list]) => ({ status, count: list.length }))
        : [],
    /** Every lead counted at any step, for drill-down. */
    rows,
  };
}
