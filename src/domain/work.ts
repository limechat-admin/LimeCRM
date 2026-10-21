/** Rules for "My work": task buckets and stale deals. Pure, so they're unit-tested. */

/** A deal with no activity or change for this long needs a nudge (Salesmate's "rotting" deals). */
export const STALE_DEAL_DAYS = 14;

/** Calendar day in IST (the team's working day), as YYYY-MM-DD. */
export function istDay(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type TaskBucket = "overdue" | "today" | "upcoming" | "someday";

/** Which list an open task belongs in, by its due day relative to today (IST). */
export function taskBucket(dueAt: Date | null, now: Date): TaskBucket {
  if (!dueAt) return "someday";
  const due = istDay(dueAt);
  const today = istDay(now);
  if (due < today) return "overdue";
  return due === today ? "today" : "upcoming";
}

export function bucketTasks<T extends { dueAt: Date | null }>(tasks: T[], now: Date): Record<TaskBucket, T[]> {
  const out: Record<TaskBucket, T[]> = { overdue: [], today: [], upcoming: [], someday: [] };
  for (const t of tasks) out[taskBucket(t.dueAt, now)].push(t);
  const byDue = (a: T, b: T) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  for (const k of Object.keys(out) as TaskBucket[]) out[k].sort(byDue);
  return out;
}

/** Whole days since the last touch, or null when there's never been one. */
export function daysSince(last: Date | null, now: Date): number | null {
  if (!last) return null;
  return Math.floor((now.getTime() - last.getTime()) / 86_400_000);
}

export function isStale(lastTouch: Date | null, now: Date, days = STALE_DEAL_DAYS): boolean {
  const d = daysSince(lastTouch, now);
  return d === null || d >= days;
}

/** A due date picked as YYYY-MM-DD means "by the end of the working day": 18:00 IST. */
export function dueAtFromDay(day: string): Date {
  return new Date(`${day}T18:00:00+05:30`);
}
