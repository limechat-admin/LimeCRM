/**
 * Field standards at runtime: the picklist values (Settings → Fields), the standardisation every
 * create and update goes through, and the admin operations on values. The rules themselves are in
 * src/domain/fields.ts.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db, type Tx } from "@/db";
import { contacts, deals, fieldOptions, organizations } from "@/db/schema";
import { matchOption, normalizeEmail, normalizePhone, normalizeWebsite, PICKLIST, PICKLISTS, tidyName, type PicklistKey } from "@/domain/fields";

export type OptionRow = { value: string; retired: boolean; position: number };
export type OptionsByField = Record<PicklistKey, OptionRow[]>;

/** Every picklist's values, in order (retired ones last). Cached per request. */
export const getFieldOptions = cache(async (): Promise<OptionsByField> => {
  const rows = await db.select().from(fieldOptions).orderBy(asc(fieldOptions.position), asc(fieldOptions.value));
  const out = Object.fromEntries(PICKLISTS.map((p) => [p.key, [] as OptionRow[]])) as OptionsByField;
  for (const r of rows) if (r.field in out) out[r.field as PicklistKey].push({ value: r.value, retired: !!r.retiredAt, position: r.position });
  for (const k of Object.keys(out) as PicklistKey[]) out[k].sort((a, b) => Number(a.retired) - Number(b.retired) || a.position - b.position);
  return out;
});

/** Select data for a form: active values, plus the record's current value if it's retired or off-list. */
export function selectData(options: OptionsByField, key: PicklistKey, current?: string | string[] | null) {
  const active = options[key].filter((o) => !o.retired).map((o) => o.value);
  const keep = (Array.isArray(current) ? current : current ? [current] : []).filter((v) => !active.includes(v));
  return [...active, ...keep];
}

export class FieldValueError extends Error {
  constructor(
    readonly field: PicklistKey,
    readonly bad: string[],
    readonly allowed: string[],
  ) {
    super(
      `${PICKLIST[field].label}: "${bad.join('", "')}" isn't one of the allowed values (${allowed.join(", ")}). An admin can add it under Settings → Fields.`,
    );
  }
}

type Table = "contacts" | "deals" | "organizations";
const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * Standardise a create or update patch before it's written:
 * picklist values become the standard spelling (or the save is refused with the allowed values),
 * websites become bare domains, emails lower case, Indian phones E.164, names trimmed.
 * Only keys present in the patch are touched.
 */
export async function standardizePatch<T extends Record<string, unknown>>(table: Table, patch: T): Promise<T> {
  const out: Record<string, unknown> = { ...patch };
  const defs = PICKLISTS.flatMap((p) => p.columns.filter((c) => c.table === table).map((c) => ({ p, prop: camel(c.column) })));
  const wanted = defs.filter((d) => d.prop in out && out[d.prop] != null);
  if (wanted.length) {
    const options = await getFieldOptions();
    for (const { p, prop } of wanted) {
      const all = options[p.key].map((o) => o.value);
      const raw = out[prop];
      const values = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
      const mapped = values.filter((v) => v.trim()).map((v) => ({ v, m: matchOption(v, all, p.aliases) }));
      const bad = mapped.filter((x) => !x.m).map((x) => x.v);
      if (bad.length)
        throw new FieldValueError(
          p.key,
          bad,
          options[p.key].filter((o) => !o.retired).map((o) => o.value),
        );
      const standard = [...new Set(mapped.map((x) => x.m!))];
      out[prop] = p.multi ? standard : (standard[0] ?? null);
    }
  }
  if (typeof out.website === "string") out.website = normalizeWebsite(out.website) ?? out.website.trim();
  if (typeof out.email === "string") out.email = normalizeEmail(out.email) ?? out.email.trim();
  if (typeof out.phone === "string") out.phone = normalizePhone(out.phone);
  if (typeof out.name === "string") out.name = tidyName(out.name);
  return out as T;
}

// ---------- usage and off-list values ----------

const TABLES = { contacts, deals, organizations } as const;

/** How many records use each value of a picklist, across every column it's used in. */
export async function optionUsage(key: PicklistKey): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const c of PICKLIST[key].columns) {
    const col = sql.identifier(c.column);
    const table = TABLES[c.table];
    const rows = PICKLIST[key].multi
      ? await db.execute<{ v: string; n: number }>(sql`select v, count(*)::int as n from ${table}, unnest(${col}) as v group by v`)
      : await db.execute<{ v: string; n: number }>(
          sql`select ${col} as v, count(*)::int as n from ${table} where ${col} is not null and ${col} <> '' group by 1`,
        );
    for (const r of rows) counts.set(r.v, (counts.get(r.v) ?? 0) + Number(r.n));
  }
  return counts;
}

/** Values stored on records that aren't on the field's list (typed before the list existed, or imported). */
export async function offListValues(key: PicklistKey) {
  const [usage, options] = await Promise.all([optionUsage(key), getFieldOptions()]);
  const listed = new Set(options[key].map((o) => o.value));
  return [...usage.entries()]
    .filter(([v]) => !listed.has(v))
    .map(([value, count]) => ({ value, count, suggestion: matchOption(value, [...listed], PICKLIST[key].aliases) }))
    .sort((a, b) => b.count - a.count);
}

/** Rewrite `from` to `to` (or remove it, with null) on every record that uses it. Returns rows changed. */
async function rewriteValue(tx: Tx, key: PicklistKey, from: string, to: string | null) {
  let n = 0;
  for (const c of PICKLIST[key].columns) {
    const col = sql.identifier(c.column);
    const table = TABLES[c.table];
    const res = PICKLIST[key].multi
      ? await tx.execute(
          to
            ? sql`update ${table} set ${col} = (select coalesce(array_agg(distinct x), '{}') from unnest(array_replace(${col}, ${from}, ${to})) x) where ${from} = any(${col})`
            : sql`update ${table} set ${col} = array_remove(${col}, ${from}) where ${from} = any(${col})`,
        )
      : await tx.execute(sql`update ${table} set ${col} = ${to} where ${col} = ${from}`);
    n += (res as unknown as { count?: number; rowCount?: number }).count ?? (res as unknown as { rowCount?: number }).rowCount ?? 0;
  }
  return n;
}

// ---------- admin operations ----------

export type FieldResult = { ok: true; message: string } | { ok: false; message: string };

export async function addOption(key: PicklistKey, raw: string): Promise<FieldResult> {
  const value = tidyName(raw);
  if (!value) return { ok: false, message: "Enter a value" };
  const options = (await getFieldOptions())[key];
  const clash = matchOption(
    value,
    options.map((o) => o.value),
  );
  if (clash) return { ok: false, message: `"${clash}" is already on the list` };
  const position = Math.max(-1, ...options.map((o) => o.position)) + 1;
  await db.insert(fieldOptions).values({ field: key, value, position });
  return { ok: true, message: `Added "${value}"` };
}

/** Rename a value everywhere it's used. */
export async function renameOption(key: PicklistKey, from: string, raw: string): Promise<FieldResult> {
  const to = tidyName(raw);
  if (!to) return { ok: false, message: "Enter the new name" };
  if (to === from) return { ok: true, message: "No change" };
  const options = (await getFieldOptions())[key];
  const clash = options.find((o) => o.value !== from && o.value.toLowerCase() === to.toLowerCase());
  if (clash) return { ok: false, message: `"${clash.value}" already exists. Retire "${from}" and replace it with "${clash.value}" instead.` };
  const n = await db.transaction(async (tx) => {
    await tx
      .update(fieldOptions)
      .set({ value: to })
      .where(and(eq(fieldOptions.field, key), eq(fieldOptions.value, from)));
    return rewriteValue(tx, key, from, to);
  });
  return { ok: true, message: `Renamed to "${to}" on ${n} ${n === 1 ? "record" : "records"}` };
}

/**
 * Stop offering a value. With `replaceWith`, records using it move to that value (and the old
 * value is removed from the list); without, it stays valid on old records.
 */
export async function retireOption(key: PicklistKey, value: string, replaceWith: string | null): Promise<FieldResult> {
  if (replaceWith === value) return { ok: false, message: "Pick a different value to replace it with" };
  const options = (await getFieldOptions())[key];
  if (replaceWith && !options.some((o) => o.value === replaceWith && !o.retired)) return { ok: false, message: "Replace it with an active value" };
  const n = await db.transaction(async (tx) => {
    if (!replaceWith) {
      await tx
        .update(fieldOptions)
        .set({ retiredAt: new Date() })
        .where(and(eq(fieldOptions.field, key), eq(fieldOptions.value, value)));
      return 0;
    }
    const moved = await rewriteValue(tx, key, value, replaceWith);
    await tx.delete(fieldOptions).where(and(eq(fieldOptions.field, key), eq(fieldOptions.value, value)));
    return moved;
  });
  return { ok: true, message: replaceWith ? `Replaced "${value}" with "${replaceWith}" on ${n} ${n === 1 ? "record" : "records"}` : `Retired "${value}"` };
}

export async function restoreOption(key: PicklistKey, value: string): Promise<FieldResult> {
  await db
    .update(fieldOptions)
    .set({ retiredAt: null })
    .where(and(eq(fieldOptions.field, key), eq(fieldOptions.value, value)));
  return { ok: true, message: `"${value}" is offered again` };
}

/** Map an off-list value (on records) onto a listed one, or clear it with null. */
export async function mapOffListValue(key: PicklistKey, from: string, to: string | null): Promise<FieldResult> {
  const options = (await getFieldOptions())[key];
  if (to && !options.some((o) => o.value === to)) return { ok: false, message: "Pick a value from the list" };
  const n = await db.transaction((tx) => rewriteValue(tx, key, from, to));
  return { ok: true, message: `${to ? `Changed to "${to}"` : "Cleared"} on ${n} ${n === 1 ? "record" : "records"}` };
}

/** Move a value up or down the list. */
export async function moveOption(key: PicklistKey, value: string, dir: -1 | 1): Promise<FieldResult> {
  const active = (await getFieldOptions())[key].filter((o) => !o.retired);
  const i = active.findIndex((o) => o.value === value);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= active.length) return { ok: true, message: "" };
  const order = active.map((o) => o.value);
  [order[i], order[j]] = [order[j], order[i]];
  await db.transaction(async (tx) => {
    for (const [pos, v] of order.entries())
      await tx
        .update(fieldOptions)
        .set({ position: pos })
        .where(and(eq(fieldOptions.field, key), eq(fieldOptions.value, v)));
  });
  return { ok: true, message: "" };
}

export const activeValues = async (key: PicklistKey) => (await getFieldOptions())[key].filter((o) => !o.retired).map((o) => o.value);
