import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DATA_ROOT = resolve(process.cwd(), "data/salesmate");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `--key value`, `--key=value` and bare `--flag` (= "true"). */
export function parseArgs(argv = process.argv.slice(2)) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = "true";
  }
  return out;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Write via a temp file + rename so an interrupted run never leaves half a file behind (resume trusts what exists). */
export function writeJson(path: string, data: unknown, pretty = false) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data));
  renameSync(tmp, path);
}

export function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function listJson(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

/** Most recent snapshot directory (names are sortable timestamps). */
export function latestSnapshot() {
  if (!existsSync(DATA_ROOT)) return null;
  const dirs = readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{8}T\d{6}Z$/.test(d.name))
    .map((d) => d.name)
    .sort();
  return dirs.length ? join(DATA_ROOT, dirs[dirs.length - 1]) : null;
}

export function resolveSnapshot(arg: string | undefined) {
  const dir = arg && arg !== "true" ? resolve(arg) : latestSnapshot();
  if (!dir || !existsSync(dir)) throw new Error("No snapshot found. Run `pnpm migrate:extract` first or pass --snapshot <dir>.");
  return dir;
}

export const timestampDir = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

/** Run `fn` over `items` with at most `concurrency` in flight. */
export async function pool<T>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

/** ₹ in lakhs, the unit the business talks in. */
export const lakh = (n: number) => `₹${(n / 100000).toFixed(2)}L`;

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
