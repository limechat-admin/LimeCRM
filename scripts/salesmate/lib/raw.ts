/** Defensive readers for Salesmate's loosely-typed JSON (numbers as strings, 0 for "no date", "" for null, ...). */

export type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Search responses: `{ data: [...], totalRows }`, sometimes nested once more. */
export function rowsOf(data: unknown): Raw[] {
  if (Array.isArray(data)) return data.filter(isObj);
  if (isObj(data)) {
    for (const k of ["data", "Data", "records", "rows"]) {
      if (k in data) return rowsOf(data[k]);
    }
  }
  return [];
}

/** Dotted path lookup that also accepts flat "deal.owner.name"-style keys from search rows. */
export function get(obj: unknown, path: string): unknown {
  if (!isObj(obj)) return undefined;
  if (path in obj) return obj[path];
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Id of a reference that may be `{ id }`, a number, a numeric string, or `<field>Id`. */
export function refId(obj: unknown, field: string): number | null {
  const v = get(obj, field);
  const id = isObj(v) ? v.id : v ?? get(obj, `${field}Id`) ?? get(obj, `${field}_id`);
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (isObj(v)) return str(v.name ?? v.value ?? v.label ?? null);
  if (Array.isArray(v)) return v.length ? v.map((x) => str(x)).filter(Boolean).join("; ") : null;
  const s = String(v).trim();
  return s === "" || s === "null" || s === "undefined" ? null : s;
}

export function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Multi-selects arrive as arrays, or as ";"/","-separated strings. */
export function list(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => str(x)).filter((x): x is string => !!x);
  const s = str(v);
  return s ? s.split(/\s*[;,]\s*/).filter(Boolean) : [];
}

/** ISO string, unix seconds/ms (number or string), "", 0 or null → Date | null. */
export function date(v: unknown): Date | null {
  if (v === null || v === undefined || v === "" || v === 0 || v === "0") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d+(\.\d+)?$/.test(v))) {
    const n = Number(v);
    if (!n) return null;
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : d;
}

/** yyyy-mm-dd in IST: Salesmate stores dates as midnight IST, i.e. 18:30Z the day before. */
export function day(v: unknown): string | null {
  const d = date(v);
  if (!d) return null;
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
