/** Report date ranges. Pure (no DB, no React) so it is shared by the page, the CSV route and tests.
 *  Every date is a calendar day in India (IST), as `YYYY-MM-DD`; ranges are inclusive. */

export const RANGE_PRESETS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "quarter", label: "This quarter" },
  { value: "custom", label: "Custom" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export type DateRange = { preset: RangePreset; from: string; to: string; label: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Last day of a 1-based month. */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const isRealDay = (s: string) => ISO_DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Today's date in India. */
export function todayIst(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-10" → "Oct 2026". */
export const monthLabel = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`));

/** `YYYY-MM-DD` (or a longer ISO string) → `YYYY-MM`. */
export const monthOf = (day: string) => day.slice(0, 7);

/**
 * Parse a report's `?<report>=` value: a preset name or a custom `YYYY-MM-DD_YYYY-MM-DD` range.
 * Anything unreadable falls back to `fallback`. Quarters are calendar quarters, which line up with
 * India's April–March financial-year quarters.
 */
export function parseRange(value: string | undefined | null, today: string, fallback: Exclude<RangePreset, "custom"> = "this_month"): DateRange {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  if (value && value.includes("_")) {
    const [a, b] = value.split("_");
    if (isRealDay(a) && isRealDay(b)) {
      const [from, to] = a <= b ? [a, b] : [b, a];
      return { preset: "custom", from, to, label: `${dayFmt.format(new Date(`${from}T00:00:00Z`))} – ${dayFmt.format(new Date(`${to}T00:00:00Z`))}` };
    }
  }
  const preset = value === "this_month" || value === "last_month" || value === "quarter" ? value : fallback;
  if (preset === "last_month") {
    const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    return { preset, from: ymd(ly, lm, 1), to: ymd(ly, lm, lastDay(ly, lm)), label: monthLabel(`${ly}-${pad(lm)}`) };
  }
  if (preset === "quarter") {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const fyQuarter = ((Math.floor((m - 1) / 3) + 3) % 4) + 1; // Apr–Jun is Q1 of India's financial year
    const fyStart = m >= 4 ? y : y - 1;
    return {
      preset,
      from: ymd(y, qStart, 1),
      to: ymd(y, qStart + 2, lastDay(y, qStart + 2)),
      label: `Q${fyQuarter} FY${String(fyStart + 1).slice(2)} (${monthLabel(`${y}-${pad(qStart)}`).split(" ")[0]}–${monthLabel(`${y}-${pad(qStart + 2)}`)})`,
    };
  }
  return { preset: "this_month", from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)), label: monthLabel(`${y}-${pad(m)}`) };
}

/** The URL value for a range: the preset name, or `from_to` for a custom range. */
export const rangeParam = (r: Pick<DateRange, "preset" | "from" | "to">) => (r.preset === "custom" ? `${r.from}_${r.to}` : r.preset);

/** Whether a `YYYY-MM-DD` day (or null) falls inside the range. */
export const inRange = (day: string | null | undefined, r: Pick<DateRange, "from" | "to">) => !!day && day >= r.from && day <= r.to;

/** Every `YYYY-MM` the range touches, oldest first. */
export function monthsIn(r: Pick<DateRange, "from" | "to">) {
  const out: string[] = [];
  let y = Number(r.from.slice(0, 4));
  let m = Number(r.from.slice(5, 7));
  const end = monthOf(r.to);
  while (`${y}-${pad(m)}` <= end && out.length < 600) {
    out.push(`${y}-${pad(m)}`);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

/** Whole days from one `YYYY-MM-DD` to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
