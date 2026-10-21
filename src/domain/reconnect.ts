/** Nurture ("Reconnect"): when to get back in touch with a company that isn't buying yet. Pure. */
import { istDay } from "./work";

/** Salesmate's Reconnect stages, as presets. "Enterprise" was a long-cycle list, so it's 6 months. */
export const RECONNECT_PRESETS = [
  { key: "1m", label: "In 1 month", months: 1 },
  { key: "3m", label: "In 3 months", months: 3 },
  { key: "6m", label: "In 6 months", months: 6 },
] as const;

export type ReconnectPreset = (typeof RECONNECT_PRESETS)[number]["key"];

/** Today (IST) plus whole months, as YYYY-MM-DD. The 31st rolls back to the month's last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function reconnectDateFor(preset: ReconnectPreset, now: Date): string {
  const p = RECONNECT_PRESETS.find((x) => x.key === preset)!;
  return addMonths(istDay(now), p.months);
}

export type ReconnectBucket = "overdue" | "this_week" | "later";

/** Overdue (before today), this week (today to 7 days out) or later, in IST. */
export function reconnectBucket(on: string, now: Date): ReconnectBucket {
  const today = istDay(now);
  if (on < today) return "overdue";
  const weekOut = istDay(new Date(now.getTime() + 7 * 86_400_000));
  return on <= weekOut ? "this_week" : "later";
}

/** Salesmate Reconnect stage → months from the snapshot day and the reason we keep. */
export function fromSalesmateStage(stage: string): { months: number; reason: string } | null {
  const s = stage.trim().toLowerCase();
  if (s.includes("1 month")) return { months: 1, reason: "Salesmate: Reconnect in 1 month" };
  if (s.includes("3 month")) return { months: 3, reason: "Salesmate: Reconnect in 3 months" };
  if (s.includes("6 month")) return { months: 6, reason: "Salesmate: Reconnect in 6 months" };
  if (s.includes("enterprise")) return { months: 6, reason: "Salesmate: Reconnect Enterprise" };
  if (s.includes("untouched") || s === "new") return { months: 1, reason: "Salesmate: Reconnect, untouched" };
  return null;
}
