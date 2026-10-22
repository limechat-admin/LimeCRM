/**
 * Salesmate → raw JSON snapshot (Phase 0 of docs/PLAN.md §5).
 *
 *   pnpm migrate:extract                 # new snapshot in data/salesmate/<timestamp>/
 *   pnpm migrate:extract --resume        # continue the latest unfinished snapshot
 *   pnpm migrate:extract --limit 500     # smoke test: first 500 records per module
 *   pnpm migrate:extract --only deals --rps 2 --concurrency 2
 *
 * Uses the raw REST API (the Salesmate MCP is broken). Lists every record with
 * POST /apis/<module>/v4/search (server-side filters don't work, so no filters), then
 * GET /apis/<module>/v4/{id} for full custom fields: every deal, and the contacts and
 * companies those deals reference. Activities are listed only.
 *
 * Resumable: every page and record is its own file, written atomically; a rerun skips what exists.
 */
import "dotenv/config";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ApiError, SalesmateApi } from "./lib/api";
import { refId, rowsOf } from "./lib/raw";
import { DATA_ROOT, latestSnapshot, listJson, parseArgs, pool, readJson, timestampDir, writeJson } from "./lib/util";

type ModuleKey = "deals" | "contacts" | "companies" | "activities";

type ModuleDef = {
  path: string;
  moduleId: number;
  /** Tried in order until the search endpoint accepts one. */
  fieldSets: string[][];
};

const MODULES: Record<ModuleKey, ModuleDef> = {
  deals: {
    path: "deal",
    moduleId: 4,
    fieldSets: [
      ["deal.id", "deal.title", "deal.stage", "deal.stage_id", "deal.pipeline", "deal.pipeline_id", "deal.dealValue", "deal.owner.name", "deal.estimatedCloseDate", "deal.primaryContact.name", "deal.status"],
      ["deal.id", "deal.title"],
    ],
  },
  contacts: {
    path: "contact",
    moduleId: 1,
    fieldSets: [
      ["contact.id", "contact.name", "contact.email", "contact.mobile", "contact.designation", "contact.company.name", "contact.owner.name"],
      ["contact.id", "contact.name", "contact.email"],
      ["contact.id"],
    ],
  },
  companies: {
    path: "company",
    moduleId: 5,
    fieldSets: [["company.id", "company.name", "company.website", "company.owner.name"], ["company.id", "company.name"], ["company.id"]],
  },
  activities: {
    path: "activity",
    moduleId: 3,
    fieldSets: [
      ["activity.id", "activity.title", "activity.type", "activity.dueDate", "activity.isCompleted", "activity.completedAt", "activity.owner.name", "activity.deal.id", "activity.primaryContact.id", "activity.primaryCompany.id", "activity.createdAt"],
      ["activity.id", "activity.title", "activity.type", "activity.dueDate", "activity.owner.name"],
      ["activity.id"],
    ],
  },
};

// Users and field metadata aren't documented for v4; probe a few known shapes and keep whichever answers.
const USER_ENDPOINTS = ["/apis/core/v4/users?status=active", "/apis/core/v4/users", "/apis/v3/users", "/apis/v1/users"];
const FIELD_ENDPOINTS = (module: string, moduleId: number) => [
  `/apis/core/v4/fields?moduleName=${module}`,
  `/apis/core/v4/modules/${moduleId}/fields`,
  `/apis/v3/fields?moduleName=${module}`,
  `/apis/v1/fields?moduleName=${module}`,
  `/apis/${module.toLowerCase()}/v4/fields`,
];

/**
 * The field schema (internal key → label for every field, custom ones included). Not in the public
 * docs, but the web app's own /fe/all-visible-fields answers to the API key. It returns every
 * module at once; it's split per module so a label used on both deals and companies (LC Account
 * ID) resolves to the right key for each.
 */
const SCHEMA_ENDPOINT = "/fe/all-visible-fields";
const SCHEMA_MODULES = { deal: "fields-deal", contact: "fields-contact", company: "fields-company" } as const;

async function fieldSchema() {
  if (Object.values(SCHEMA_MODULES).every((n) => existsSync(join(dir, "meta", `${n}.json`)))) return;
  try {
    const data = (await api.request("GET", SCHEMA_ENDPOINT)) as Record<string, unknown>[] | Record<string, unknown>;
    const blocks = Array.isArray(data) ? data : [data];
    for (const [module, name] of Object.entries(SCHEMA_MODULES)) {
      const fields = blocks.flatMap((b) => (Array.isArray(b[module]) ? (b[module] as unknown[]) : []));
      if (!fields.length) continue;
      writeJson(join(dir, "meta", `${name}.json`), { endpoint: SCHEMA_ENDPOINT, data: fields }, true);
      manifest.probes[name] = SCHEMA_ENDPOINT;
      console.log(`  ${name}: ${fields.length} fields from ${SCHEMA_ENDPOINT}`);
    }
  } catch (e) {
    if (!(e instanceof ApiError) || e.status >= 500) throw e;
    console.warn(`  ${SCHEMA_ENDPOINT} refused (${e.status}); trying the other field endpoints`);
  }
}

type Manifest = {
  startedAt: string;
  completedAt?: string;
  limit?: number;
  searchFieldSet: Partial<Record<ModuleKey, number>>;
  counts: Record<string, number>;
  probes: Record<string, string | null>;
  notes: string[];
};

const args = parseArgs();
const rows = 250;
const limit = args.limit ? Number(args.limit) : undefined;
const concurrency = Number(args.concurrency ?? 3);
const only = new Set((args.only ?? "deals,contacts,companies,activities").split(",") as ModuleKey[]);

function snapshotDir() {
  if (args.out) return args.out;
  if (args.resume) {
    const last = latestSnapshot();
    if (last && !readJson<Manifest>(join(last, "manifest.json")).completedAt) return last;
    if (last) console.log(`latest snapshot ${last} is complete; starting a new one`);
  }
  return join(DATA_ROOT, timestampDir());
}

const dir = snapshotDir();
const manifestPath = join(dir, "manifest.json");
const manifest: Manifest = existsSync(manifestPath)
  ? readJson<Manifest>(manifestPath)
  : { startedAt: new Date().toISOString(), limit, searchFieldSet: {}, counts: {}, probes: {}, notes: [] };
const saveManifest = () => writeJson(manifestPath, manifest, true);

const api = SalesmateApi.fromEnv(Number(args.rps ?? 3));

async function probe(name: string, candidates: string[]) {
  const out = join(dir, "meta", `${name}.json`);
  if (existsSync(out)) return;
  for (const path of candidates) {
    try {
      const data = await api.request("GET", path);
      writeJson(out, { endpoint: path, data }, true);
      manifest.probes[name] = path;
      console.log(`  ${name}: ${path}`);
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
    }
  }
  manifest.probes[name] = null;
  manifest.notes.push(`No working endpoint for ${name}; transform falls back to the field keys in fields.ts.`);
  console.warn(`  ${name}: no endpoint answered`);
}

function searchBody(key: ModuleKey, fields: string[], sorted: boolean) {
  const m = MODULES[key];
  return {
    displayingFields: fields,
    filterQuery: { group: { operator: "AND", rules: [] } },
    // Sort by id so offsets stay stable while we page (totalRows is unreliable, so we page until a short page).
    sort: sorted ? [{ fieldName: `${m.path}.id`, order: "asc" }] : undefined,
    moduleId: m.moduleId,
    reportType: "get_data",
    getRecordsCount: true,
    getRecords: true,
  };
}

async function searchPage(key: ModuleKey, from: number) {
  const m = MODULES[key];
  const url = `/apis/${m.path}/v4/search?rows=${rows}&from=${from}`;
  const chosen = manifest.searchFieldSet[key];
  if (chosen !== undefined) {
    const [set, sorted] = [Math.floor(chosen / 2), chosen % 2 === 0];
    return rowsOf(await api.request("POST", url, searchBody(key, m.fieldSets[set], sorted)));
  }
  // First page: find a field set (and sort) the endpoint accepts, then stick to it for every page.
  let lastErr: unknown;
  for (let set = 0; set < m.fieldSets.length; set++) {
    for (const sorted of [true, false]) {
      try {
        const data = rowsOf(await api.request("POST", url, searchBody(key, m.fieldSets[set], sorted)));
        manifest.searchFieldSet[key] = set * 2 + (sorted ? 0 : 1);
        if (!sorted) manifest.notes.push(`${key}: search rejected sort-by-id; paging unsorted (deduped by id).`);
        saveManifest();
        return data;
      } catch (e) {
        if (!(e instanceof ApiError) || e.status >= 500) throw e;
        lastErr = e;
      }
    }
  }
  throw lastErr;
}

async function list(key: ModuleKey) {
  const pagesDir = join(dir, key, "pages");
  let total = 0;
  for (let from = 0; ; from += rows) {
    const file = join(pagesDir, `${String(from).padStart(7, "0")}.json`);
    let data: Record<string, unknown>[];
    if (existsSync(file)) data = readJson<{ data: Record<string, unknown>[] }>(file).data;
    else {
      data = await searchPage(key, from);
      writeJson(file, { from, rows, fetchedAt: new Date().toISOString(), data });
    }
    total += data.length;
    process.stdout.write(`\r  ${key}: listed ${total}`);
    if (data.length < rows || (limit && total >= limit)) break;
  }
  process.stdout.write("\n");
  const ids = listedIds(key);
  if (ids.length !== total) manifest.notes.push(`${key}: ${total} rows listed but ${ids.length} unique ids (offset drift while paging).`);
  manifest.counts[`${key}.listed`] = ids.length;
  saveManifest();
  return ids;
}

function listedIds(key: ModuleKey) {
  const ids = new Set<number>();
  for (const f of listJson(join(dir, key, "pages"))) {
    for (const r of readJson<{ data: Record<string, unknown>[] }>(f).data) {
      const id = Number(r.id ?? r[`${MODULES[key].path}.id`]);
      if (id) ids.add(id);
    }
  }
  return [...ids].slice(0, limit);
}

async function details(key: ModuleKey, ids: number[]) {
  const m = MODULES[key];
  const detailDir = join(dir, key, "detail");
  const errorsPath = join(dir, key, "detail-errors.json");
  const todo = ids.filter((id) => !existsSync(join(detailDir, `${id}.json`)));
  const errors: Record<string, string> = {};
  let done = ids.length - todo.length;
  await pool(todo, concurrency, async (id) => {
    try {
      writeJson(join(detailDir, `${id}.json`), await api.request("GET", `/apis/${m.path}/v4/${id}`));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      errors[id] = `${e.status} ${e.body.slice(0, 200)}`;
    }
    done++;
    if (done % 25 === 0 || done === ids.length) process.stdout.write(`\r  ${key}: detail ${done}/${ids.length}`);
  });
  process.stdout.write(`\r  ${key}: detail ${done}/${ids.length}\n`);
  if (!Object.keys(errors).length) rmSync(errorsPath, { force: true });
  else {
    writeJson(errorsPath, errors, true);
    console.warn(`  ${key}: ${Object.keys(errors).length} detail fetches failed (see ${errorsPath}); rerun with --resume to retry`);
  }
  manifest.counts[`${key}.detail`] = listJson(detailDir).length;
  saveManifest();
}

function referenced(key: ModuleKey, field: string) {
  const ids = new Set<number>();
  for (const f of listJson(join(dir, key, "detail"))) {
    const id = refId(readJson<Record<string, unknown>>(f), field);
    if (id) ids.add(id);
  }
  return ids;
}

async function main() {
  console.log(`snapshot: ${dir}`);
  saveManifest();

  console.log("probing users and field metadata");
  await probe("users", USER_ENDPOINTS);
  await fieldSchema();
  for (const [name, id] of [["Deal", 4], ["Contact", 1], ["Company", 5]] as const) {
    await probe(`fields-${name.toLowerCase()}`, FIELD_ENDPOINTS(name, id));
  }

  if (only.has("deals")) await details("deals", await list("deals"));

  if (only.has("contacts")) {
    await list("contacts");
    await details("contacts", [...referenced("deals", "primaryContact")]);
  }

  if (only.has("companies")) {
    await list("companies");
    const ids = new Set([...referenced("deals", "primaryCompany"), ...referenced("contacts", "company")]);
    await details("companies", [...ids]);
  }

  if (only.has("activities")) await list("activities");

  manifest.completedAt = new Date().toISOString();
  manifest.counts.requests = (manifest.counts.requests ?? 0) + api.requests;
  saveManifest();
  console.log(`done: ${JSON.stringify(manifest.counts)}`);
  for (const n of manifest.notes) console.log(`note: ${n}`);
}

main().catch((e) => {
  saveManifest();
  console.error(e instanceof ApiError ? `${e.message}\n${e.body}` : e);
  console.error("Partial snapshot kept. Rerun with --resume to continue.");
  process.exit(1);
});
