/** Bulk edit on lists: what was asked for, and how to report per-record results. Pure. */

/** Most records one bulk change may touch. Each is its own audited update. */
export const MAX_BULK = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The selected record ids, de-duplicated; anything that isn't an id is dropped. */
export function parseBulkIds(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => UUID.test(s)),
    ),
  ];
}

/** A bulk field: "" leaves it as it is, "none" clears it, anything else sets it. */
export const CLEAR = "none";
export type BulkChoice = { change: false } | { change: true; value: string | null };

export function bulkChoice(raw: unknown): BulkChoice {
  if (typeof raw !== "string" || raw === "") return { change: false };
  return { change: true, value: raw === CLEAR ? null : raw };
}

export type BulkOutcome = { name: string; ok: true } | { name: string; ok: false; why: string };

/**
 * One line for the toast: "Updated 12 leads. 2 not changed: Asha (Meeting date), Ravi (…)".
 * `verb` and `suffix` reword the head: "Moved 3 leads to SQL."
 */
export function summarizeBulk(outcomes: BulkOutcome[], noun: [string, string], { verb = "Updated", suffix = "" } = {}): { ok: boolean; message: string } {
  const done = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o): o is Extract<BulkOutcome, { ok: false }> => !o.ok);
  const word = (n: number) => (n === 1 ? noun[0] : noun[1]);
  const head = done ? `${verb} ${done} ${word(done)}${suffix}.` : `Nothing ${verb.toLowerCase()}.`;
  if (!failed.length) return { ok: true, message: head };
  const shown = failed.slice(0, 3).map((f) => `${f.name} (${f.why})`);
  const more = failed.length > 3 ? `, and ${failed.length - 3} more` : "";
  return { ok: done > 0, message: `${head} ${failed.length} not changed: ${shown.join(", ")}${more}.` };
}
