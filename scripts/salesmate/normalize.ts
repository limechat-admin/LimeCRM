/** Raw snapshot files → typed Salesmate records. No business rules here; those live in transform.ts. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COMPANY_FIELDS, CONTACT_FIELDS, DEAL_FIELDS, fieldReader, resolveFields, type CompanyField, type ContactField, type DealField, type Resolved } from "./fields";
import { date, day, get, list, num, refId, rowsOf, str, type Raw } from "./lib/raw";
import { listJson, readJson } from "./lib/util";

export type Pipeline = "sales" | "onboarding" | "cs" | "reconnect" | "other";

export type SmUser = { id: number; name: string; email: string | null; active: boolean };

export type SmDeal = {
  id: number;
  title: string;
  pipeline: Pipeline;
  pipelineName: string;
  stage: string;
  stageId: number | null;
  /** Salesmate `dealValue`: monthly MRR in INR. */
  value: number;
  status: string;
  lostReason: string | null;
  ownerId: number | null;
  contactId: number | null;
  contactName: string | null;
  companyId: number | null;
  companyName: string | null;
  createdAt: Date | null;
  modifiedAt: Date | null;
  closedAt: Date | null;
  estimatedClose: Date | null;
  priority: string | null;
  source: string | null;
  hasDetail: boolean;
  f: (name: DealField) => unknown;
};

export type SmContact = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  companyId: number | null;
  ownerId: number | null;
  leadStatus: string | null;
  leadStage: string | null;
  source: string | null;
  productType: string[];
  partnerName: string | null;
  meetingScheduledAt: string | null;
  meetingCompletedAt: string | null;
  qualifiedAt: string | null;
  sqlAt: string | null;
};

export type SmCompany = {
  id: number;
  name: string;
  website: string | null;
  lcAccountIds: number[];
  chargebeeCustomerId: string | null;
  city: string | null;
  websiteTrafficRange: string | null;
};

export type SmActivity = {
  id: number;
  title: string;
  type: string | null;
  description: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  isCompleted: boolean;
  ownerId: number | null;
  dealId: number | null;
  contactId: number | null;
  companyId: number | null;
  createdAt: Date | null;
};

export type Snapshot = {
  dir: string;
  manifest: Raw;
  users: Map<number, SmUser>;
  deals: SmDeal[];
  contacts: Map<number, SmContact>;
  companies: Map<number, SmCompany>;
  activities: SmActivity[];
  fields: { deal: Resolved<DealField>; company: Resolved<CompanyField>; contact: Resolved<ContactField> };
  /** Raw deal records, for the custom-field census. */
  rawDeals: Raw[];
};

const PIPELINE_BY_ID: Record<number, Pipeline> = { 2: "sales", 6: "onboarding", 3: "cs", 4: "reconnect" };

function pipelineOf(id: number | null, name: string): Pipeline {
  if (id && PIPELINE_BY_ID[id]) return PIPELINE_BY_ID[id];
  const n = name.toLowerCase();
  if (n.startsWith("sales")) return "sales";
  if (n.startsWith("onboarding")) return "onboarding";
  if (n.startsWith("customer success")) return "cs";
  if (n.startsWith("reconnect")) return "reconnect";
  return "other";
}

/** Merge list rows with detail records (detail wins). Search rows may use flat "deal.title" keys. */
function records(dir: string, module: string, prefix: string) {
  const byId = new Map<number, { raw: Raw; hasDetail: boolean }>();
  for (const f of listJson(join(dir, module, "pages"))) {
    for (const row of readJson<{ data: Raw[] }>(f).data) {
      const flat: Raw = {};
      for (const [k, v] of Object.entries(row)) flat[k.startsWith(`${prefix}.`) ? k.slice(prefix.length + 1) : k] = v;
      const id = Number(flat.id);
      if (id) byId.set(id, { raw: flat, hasDetail: false });
    }
  }
  for (const f of listJson(join(dir, module, "detail"))) {
    const raw = readJson<Raw>(f);
    const id = Number(raw.id);
    if (id) byId.set(id, { raw: { ...byId.get(id)?.raw, ...raw }, hasDetail: true });
  }
  return [...byId.values()];
}

const personName = (r: Raw) =>
  str(r.name) ?? ([str(r.firstName), str(r.lastName)].filter(Boolean).join(" ") || null);

export function loadSnapshot(dir: string): Snapshot {
  const manifestPath = join(dir, "manifest.json");
  const manifest = existsSync(manifestPath) ? readJson<Raw>(manifestPath) : {};
  const fields = {
    deal: resolveFields(DEAL_FIELDS, dir, "deal"),
    company: resolveFields(COMPANY_FIELDS, dir, "company"),
    contact: resolveFields(CONTACT_FIELDS, dir, "contact"),
  };

  const users = new Map<number, SmUser>();
  const addUser = (u: unknown) => {
    const id = refId(u, "id") ?? (typeof u === "object" && u ? Number((u as Raw).id) : 0);
    if (!id || typeof u !== "object" || u === null) return;
    const r = u as Raw;
    const prev = users.get(id);
    users.set(id, {
      id,
      name: personName(r) ?? prev?.name ?? `Salesmate user ${id}`,
      email: str(r.email)?.toLowerCase() ?? prev?.email ?? null,
      active: r.status !== undefined ? /active/i.test(String(r.status)) && !/inactive/i.test(String(r.status)) : prev?.active ?? true,
    });
  };
  const usersPath = join(dir, "meta", "users.json");
  if (existsSync(usersPath)) {
    const data = readJson<Raw>(usersPath).data;
    (Array.isArray(data) ? data : rowsOf(data)).forEach(addUser);
  }

  const rawDeals: Raw[] = [];
  const deals: SmDeal[] = records(dir, "deals", "deal").map(({ raw, hasDetail }) => {
    rawDeals.push(raw);
    const owner = get(raw, "owner");
    // Embedded owners carry email; users.json may not exist. Don't let a name-only ref overwrite a full one.
    if (typeof owner === "object" && owner && (!users.has(Number((owner as Raw).id)) || (owner as Raw).email)) addUser(owner);
    const pipelineId = num(raw.pipeline_id ?? raw.pipelineId);
    const pipelineName = str(raw.pipeline) ?? "";
    return {
      id: Number(raw.id),
      title: str(raw.title) ?? `(untitled ${raw.id})`,
      pipeline: pipelineOf(pipelineId, pipelineName),
      pipelineName,
      stage: str(raw.stage) ?? "",
      stageId: num(raw.stage_id ?? raw.stageId),
      value: num(raw.dealValue) ?? 0,
      status: str(raw.status) ?? "Open",
      lostReason: str(raw.lostReason),
      ownerId: refId(raw, "owner"),
      contactId: refId(raw, "primaryContact"),
      contactName: str(get(raw, "primaryContact.name")),
      companyId: refId(raw, "primaryCompany"),
      companyName: str(get(raw, "primaryCompany.name")),
      createdAt: date(raw.createdAt),
      modifiedAt: date(raw.lastModifiedAt ?? raw.updatedAt),
      closedAt: date(raw.closedDate),
      estimatedClose: date(raw.estimatedCloseDate),
      priority: str(raw.priority),
      source: str(raw.source),
      hasDetail,
      f: fieldReader(fields.deal, raw),
    };
  });

  const contacts = new Map<number, SmContact>();
  for (const { raw } of records(dir, "contacts", "contact")) {
    const f = fieldReader(fields.contact, raw);
    const id = Number(raw.id);
    contacts.set(id, {
      id,
      name: personName(raw) ?? str(raw.email) ?? `(contact ${id})`,
      email: str(raw.email)?.toLowerCase() ?? null,
      phone: str(raw.mobile) ?? str(raw.phone) ?? str(raw.otherPhone),
      designation: str(raw.designation) ?? str(raw.jobTitle) ?? str(f("designation")),
      companyId: refId(raw, "company") ?? refId(raw, "primaryCompany"),
      ownerId: refId(raw, "owner"),
      leadStatus: str(f("leadStatus")),
      leadStage: str(f("leadStage")),
      source: str(f("contactSource")) ?? str(raw.source),
      productType: list(f("productType")),
      partnerName: str(f("partnerName")),
      meetingScheduledAt: day(f("meetingScheduledDate")),
      meetingCompletedAt: day(f("meetingCompletedDate")),
      qualifiedAt: day(f("qualifiedMeetingDate")),
      sqlAt: day(f("sqlDate")),
    });
  }

  const companies = new Map<number, SmCompany>();
  for (const { raw } of records(dir, "companies", "company")) {
    const f = fieldReader(fields.company, raw);
    const id = Number(raw.id);
    companies.set(id, {
      id,
      name: str(raw.name) ?? `(company ${id})`,
      website: str(raw.website) ?? str(f("brandWebsite")) ?? str(f("domain")),
      lcAccountIds: list(f("lcAccountId")).map(Number).filter((n) => Number.isInteger(n) && n > 0),
      chargebeeCustomerId: str(f("chargebeeCustomerId")),
      city: str(raw.billingCity) ?? str(raw.city),
      websiteTrafficRange: str(f("websiteTrafficRange")),
    });
  }
  // Companies we only know by reference from a deal.
  for (const d of deals) {
    if (d.companyId && !companies.has(d.companyId)) {
      companies.set(d.companyId, { id: d.companyId, name: d.companyName ?? `(company ${d.companyId})`, website: null, lcAccountIds: [], chargebeeCustomerId: null, city: null, websiteTrafficRange: null });
    }
  }

  const activities: SmActivity[] = records(dir, "activities", "activity").map(({ raw }) => ({
    id: Number(raw.id),
    title: str(raw.title) ?? str(raw.type) ?? "Activity",
    type: str(raw.type),
    description: str(raw.description) ?? str(raw.note),
    dueAt: date(raw.dueDate),
    completedAt: date(raw.completedAt),
    isCompleted: raw.isCompleted === true || raw.isCompleted === 1 || raw.isCompleted === "1" || raw.isCompleted === "true",
    ownerId: refId(raw, "owner"),
    dealId: refId(raw, "deal") ?? refId(raw, "primaryDeal") ?? refId(raw, "relatedDeal"),
    contactId: refId(raw, "primaryContact") ?? refId(raw, "contact"),
    companyId: refId(raw, "primaryCompany") ?? refId(raw, "company"),
    createdAt: date(raw.createdAt),
  }));

  return { dir, manifest, users, deals, contacts, companies, activities, fields, rawDeals };
}
