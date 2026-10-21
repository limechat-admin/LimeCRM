/** CSV export and lead-import mapping. Pure, so it's unit-tested. */

// ---------- export ----------

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

/**
 * One CSV cell. Quotes when needed, and neutralises spreadsheet formulas: a value starting with
 * = + - @ (or a tab/CR) would run as a formula when the file is opened in Excel or Sheets,
 * so it gets a leading apostrophe. Numbers are left alone so they stay numeric.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let s = Array.isArray(value) ? value.join(", ") : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  // BOM so Excel opens UTF-8 (₹, names) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------- lead import ----------

export const LEAD_IMPORT_FIELDS = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  designation: "Designation",
  companyName: "Company",
  website: "Website",
  source: "Source",
  sdrEmail: "SDR email",
  ownerEmail: "AE email",
  linkedinUrl: "LinkedIn",
} as const;

export type LeadImportField = keyof typeof LEAD_IMPORT_FIELDS;
export type ColumnMap = Partial<Record<LeadImportField, string>>;

/** Header spellings we recognise for each field (compared lower-case, punctuation stripped). */
const ALIASES: Record<LeadImportField, string[]> = {
  name: ["name", "full name", "contact name", "contact", "lead name", "person"],
  email: ["email", "email address", "work email", "business email", "e mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "whatsapp"],
  designation: ["designation", "title", "job title", "role", "position"],
  companyName: ["company", "company name", "organization", "organisation", "account", "brand"],
  website: ["website", "website url", "domain", "url", "company website"],
  source: ["source", "lead source", "contact source"],
  sdrEmail: ["sdr", "sdr email"],
  ownerEmail: ["owner", "owner email", "ae", "ae email", "account executive"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile"],
};

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best-guess mapping from the file's headers to lead fields. */
export function guessColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  for (const field of Object.keys(ALIASES) as LeadImportField[]) {
    const hit = headers.find((h) => !used.has(h) && ALIASES[field].includes(normalizeHeader(h)));
    if (hit) {
      map[field] = hit;
      used.add(hit);
    }
  }
  return map;
}

export type LeadImportRow = {
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  companyName: string;
  website: string | null;
  source: string | null;
  sdrEmail: string | null;
  ownerEmail: string | null;
  linkedinUrl: string | null;
};

export type MappedRow = { row: number; data: LeadImportRow | null; errors: string[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/** Website without a scheme gets https:// so links work. */
function normalizeUrl(v: string | null) {
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** Apply the column map to one parsed record and validate it. `row` is the 1-based data row number. */
export function mapLeadRow(record: Record<string, unknown>, map: ColumnMap, row: number, defaultSource: string | null): MappedRow {
  const get = (f: LeadImportField) => (map[f] ? clean(record[map[f]!]) : null);
  const errors: string[] = [];
  const name = get("name");
  const companyName = get("companyName");
  const email = get("email")?.toLowerCase() ?? null;
  const sdrEmail = get("sdrEmail")?.toLowerCase() ?? null;
  const ownerEmail = get("ownerEmail")?.toLowerCase() ?? null;
  if (!name) errors.push("Name is empty");
  if (!companyName) errors.push("Company is empty");
  if (email && !EMAIL.test(email)) errors.push(`"${email}" isn't an email address`);
  if (sdrEmail && !EMAIL.test(sdrEmail)) errors.push(`SDR "${sdrEmail}" isn't an email address`);
  if (ownerEmail && !EMAIL.test(ownerEmail)) errors.push(`AE "${ownerEmail}" isn't an email address`);
  if (errors.length) return { row, data: null, errors };
  return {
    row,
    errors,
    data: {
      name: name!,
      companyName: companyName!,
      email,
      phone: get("phone"),
      designation: get("designation"),
      website: normalizeUrl(get("website")),
      source: get("source") ?? defaultSource,
      sdrEmail,
      ownerEmail,
      linkedinUrl: normalizeUrl(get("linkedinUrl")),
    },
  };
}

/** Rows whose email appears earlier in the same file. */
export function duplicateEmailsInFile(rows: MappedRow[]): Set<number> {
  const seen = new Set<string>();
  const dupes = new Set<number>();
  for (const r of rows) {
    const e = r.data?.email;
    if (!e) continue;
    if (seen.has(e)) dupes.add(r.row);
    seen.add(e);
  }
  return dupes;
}

export const MAX_IMPORT_ROWS = 2000;
