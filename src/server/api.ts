import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, asc, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activities, activityType, apiKeys, contacts, deals, events, lifecycle, organizations, stages, users, type User } from "@/db/schema";
import { apiKeyAccess, generateApiKey, hashApiKey, looksLikeApiKey, OPERATION_SCOPE, type ApiOperation, type ApiScope } from "@/domain/api-keys";
import type { MissingField } from "@/domain/gates";
import { bantTotal, isLeadStatus, LEAD_STATUSES } from "@/domain/leads";
import { isOneTime, monthlyValue } from "@/domain/mrr";
import { canMoveDeal, canWrite } from "@/domain/permissions";
import { getDealForAuthz } from "./authz";
import { setLeadStatus } from "./leads";
import { getDeal, getLead, getOrganization, listLeads, listStages } from "./queries";
import { transitionDeal } from "./transitions";

/**
 * Machine access to LimeCRM: per-consumer API keys (src/domain/api-keys.ts) for /api/v1 and the
 * MCP server (/api/v1/mcp), and the operations both expose. Calls made with a key act as the key's
 * owner, through the same permission rules and stage gates as the UI.
 *
 * The old shared LIMECRM_API_TOKEN still works when it's set, so existing consumers keep running
 * while they move to their own keys. It can read everything; its writes act as `actorEmail`.
 */

// ---------- authentication ----------

export type ApiCaller =
  | { via: "key"; key: { id: string; name: string; scopes: ApiScope[]; revokedAt: Date | null }; user: User }
  | { via: "shared_token"; user: null };

export type ApiFailure = { ok: false; status: number; error: string; missing?: MissingField[] };
export type ApiResult<T> = { ok: true; data: T; status?: number } | ApiFailure;

const fail = (status: number, error: string, missing?: MissingField[]): ApiFailure => ({ ok: false, status, error, missing });

// last_used_at is for the settings page ("used 3 minutes ago"), so one write a minute is plenty.
const TOUCH_EVERY = sql`interval '1 minute'`;

function sharedTokenMatches(token: string) {
  const expected = process.env.LIMECRM_API_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Who is calling: an API key (looked up by its sha256) or the legacy shared token. */
export async function authenticate(req: Request, { allowSharedToken = true } = {}): Promise<ApiResult<ApiCaller>> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return fail(401, "Missing bearer token. Send Authorization: Bearer <LimeCRM API key>.");

  if (looksLikeApiKey(token)) {
    const [row] = await db
      .select({ key: apiKeys, user: users })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.ownerId))
      .where(eq(apiKeys.keyHash, hashApiKey(token)));
    if (!row) return fail(401, "Unauthorized");
    const access = apiKeyAccess(row.key, row.user, "read");
    if (!access.ok) return fail(row.key.revokedAt ? 401 : 403, access.message);
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiKeys.id, row.key.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, sql`now() - ${TOUCH_EVERY}`))));
    const { id, name, scopes, revokedAt } = row.key;
    return { ok: true, data: { via: "key", key: { id, name, scopes, revokedAt }, user: row.user } };
  }

  if (allowSharedToken && sharedTokenMatches(token)) return { ok: true, data: { via: "shared_token", user: null } };
  return fail(401, "Unauthorized");
}

/** Can this caller run `op`? Keys are checked against their scope and their owner's role. */
export function callerMay(caller: ApiCaller, op: ApiOperation): ApiResult<null> {
  if (caller.via === "shared_token") return { ok: true, data: null };
  const access = apiKeyAccess(caller.key, caller.user, OPERATION_SCOPE[op]);
  return access.ok ? { ok: true, data: null } : fail(403, access.message);
}

/**
 * The user a write acts as. With a key that's always the key's owner (`actorEmail` is ignored);
 * the shared token has no owner, so it has to name an active LimeCRM user who can write.
 */
export async function actingUser(caller: ApiCaller, actorEmail?: string | null): Promise<ApiResult<User>> {
  if (caller.via === "key") return { ok: true, data: caller.user };
  if (!actorEmail) return fail(400, "actorEmail is required with the shared token. Use a per-user API key instead.");
  const [actor] = await db.select().from(users).where(sql`lower(${users.email}) = ${actorEmail.toLowerCase()}`);
  if (!actor || !actor.isActive) return fail(400, "actorEmail is not an active LimeCRM user");
  const write = canWrite(actor.role);
  return write.ok ? { ok: true, data: actor } : fail(403, write.message);
}

export const apiError = (f: ApiFailure) =>
  NextResponse.json(f.missing ? { error: f.error, missing: f.missing } : { error: f.error }, { status: f.status });

export const apiJson = <T>(res: ApiResult<T>) =>
  res.ok ? NextResponse.json({ data: res.data }, { status: res.status ?? 200 }) : apiError(res);

/**
 * Route-handler guard: authenticates and checks the operation. Returns the caller, or the error
 * response to send back.
 */
export async function authorize(req: Request, op: ApiOperation): Promise<ApiCaller | NextResponse> {
  const auth = await authenticate(req);
  if (!auth.ok) return apiError(auth);
  const may = callerMay(auth.data, op);
  return may.ok ? auth.data : apiError(may);
}

// ---------- lookups ----------

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/** A user given as an id, an email, or "me" (the key's owner). */
export async function resolveUserRef(ref: string, caller: ApiCaller): Promise<ApiResult<User>> {
  if (ref === "me") {
    return caller.user ? { ok: true, data: caller.user } : fail(400, '"me" needs a per-user API key');
  }
  const where = isUuid(ref) ? eq(users.id, ref) : sql`lower(${users.email}) = ${ref.toLowerCase()}`;
  const [user] = await db.select().from(users).where(where);
  return user ? { ok: true, data: user } : fail(400, `No LimeCRM user matches "${ref}" (use a user id, an email or "me")`);
}

export async function listApiUsers(role?: User["role"]) {
  const where = role ? and(eq(users.isActive, true), eq(users.role, role)) : eq(users.isActive, true);
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(where).orderBy(asc(users.name));
}

// ---------- deals ----------

export const dealFilters = z.object({
  q: z.string().trim().min(1).optional(),
  stage: z.string().trim().min(1).optional(),
  status: z.enum(["open", "won", "lost"]).optional(),
  owner: z.string().trim().min(1).optional(),
  orgId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
/** Deals across the Sales pipeline, most recently updated first, with a total for paging. */
export async function searchDeals(input: Record<string, unknown>, caller: ApiCaller) {
  const parsed = dealFilters.safeParse(input);
  if (!parsed.success) return fail(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const f = parsed.data;
  const conds: SQL[] = [];
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(or(ilike(deals.title, like), ilike(organizations.name, like))!);
  }
  if (f.stage) {
    const salesStages = await listStages("sales");
    const stage = salesStages.find((s) => s.key === f.stage || s.name.toLowerCase() === f.stage!.toLowerCase());
    if (!stage) return fail(400, `stage must be one of ${salesStages.map((s) => s.key).join(", ")}`);
    conds.push(eq(deals.stageId, stage.id));
  }
  if (f.status) conds.push(eq(deals.status, f.status));
  if (f.orgId) conds.push(eq(deals.orgId, f.orgId));
  if (f.owner) {
    const owner = await resolveUserRef(f.owner, caller);
    if (!owner.ok) return owner;
    conds.push(eq(deals.ownerId, owner.data.id));
  }
  const where = conds.length ? and(...conds) : undefined;
  const owner = alias(users, "owner");
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ deal: deals, stage: stages.name, stageKey: stages.key, orgName: organizations.name, ownerName: owner.name, ownerEmail: owner.email })
      .from(deals)
      .innerJoin(stages, eq(stages.id, deals.stageId))
      .innerJoin(organizations, eq(organizations.id, deals.orgId))
      .leftJoin(owner, eq(owner.id, deals.ownerId))
      .where(where)
      .orderBy(desc(deals.updatedAt))
      .limit(f.limit)
      .offset(f.offset),
    db.select({ total: count() }).from(deals).innerJoin(organizations, eq(organizations.id, deals.orgId)).where(where),
  ]);
  return {
    ok: true as const,
    data: rows.map(({ deal, ...rest }) => ({ ...deal, ...rest })),
    total,
  };
}

const withMonthlyValue = <T extends Parameters<typeof monthlyValue>[0]>(item: T) => ({
  ...item,
  monthlyValue: Math.round(monthlyValue(item) * 100) / 100,
  oneTime: isOneTime(item),
});

/** A deal with its organization, line items and what each stage's gate would still need. */
export async function getDealDetail(id: string) {
  if (!isUuid(id)) return null;
  const detail = await getDeal(id);
  if (!detail) return null;
  const { deal, org, lineItems, current, gates } = detail;
  const people = [deal.ownerId, deal.sdrId].filter((x): x is string => !!x);
  const named = people.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(or(...people.map((p) => eq(users.id, p))))
    : [];
  const person = (pid: string | null) => named.find((u) => u.id === pid) ?? null;
  return {
    ...deal,
    stage: current.name,
    stageKey: current.key,
    owner: person(deal.ownerId),
    sdr: person(deal.sdrId),
    org: { id: org.id, name: org.name, lifecycle: org.lifecycle, segment: org.segment, contractedMrr: org.contractedMrr },
    lineItems: lineItems.map(withMonthlyValue),
    stages: gates.map((g) => ({ key: g.stage.key, name: g.stage.name, kind: g.stage.kind, current: g.stage.id === deal.stageId, missing: g.missing })),
  };
}

export async function getDealLineItems(id: string) {
  const detail = await getDealDetail(id);
  if (!detail) return null;
  return { items: detail.lineItems, mrr: detail.mrr, oneTimeFee: detail.oneTimeFee, currency: detail.currency };
}

/** Move a deal to a Sales stage as `actor`: the UI's permission check, then the stage gate. */
export async function moveDeal(actor: User, dealId: string, stageKey: string): Promise<ApiResult<{ dealId: string; stage: string }>> {
  const deal = await getDealForAuthz(dealId);
  if (!deal) return fail(404, "Deal not found");
  const allowed = canMoveDeal(actor.role, deal.status);
  if (!allowed.ok) return fail(403, allowed.message);
  const res = await transitionDeal(dealId, stageKey, actor.id);
  if (res.ok) return { ok: true, data: { dealId, stage: stageKey } };
  if (res.error?.startsWith("Unknown stage")) {
    const salesStages = await listStages("sales");
    return fail(400, `${res.error}. Stages: ${salesStages.map((s) => s.key).join(", ")}`);
  }
  if (res.error) return fail(res.error.includes("not found") ? 404 : 400, res.error);
  return fail(422, "Stage requirements not met", res.missing);
}

// ---------- organizations ----------

export const orgFilters = z.object({
  q: z.string().trim().min(1).optional(),
  lifecycle: z.enum(lifecycle.enumValues).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** The customer book with contracted MRR and owners. `q` matches name, website or a LimeChat account id. */
export async function searchOrganizations(input: Record<string, unknown>) {
  const parsed = orgFilters.safeParse(input);
  if (!parsed.success) return fail(400, `lifecycle must be one of ${lifecycle.enumValues.join(", ")}`);
  const f = parsed.data;
  const conds: SQL[] = [];
  if (f.lifecycle) conds.push(eq(organizations.lifecycle, f.lifecycle));
  if (f.q) {
    const like = `%${f.q}%`;
    const byText = or(ilike(organizations.name, like), ilike(organizations.website, like))!;
    conds.push(/^\d+$/.test(f.q) ? or(byText, sql`${Number(f.q)} = any(${organizations.lcAccountIds})`)! : byText);
  }
  const ae = alias(users, "ae");
  const csm = alias(users, "csm");
  const query = db
    .select({
      id: organizations.id,
      name: organizations.name,
      lifecycle: organizations.lifecycle,
      segment: organizations.segment,
      contractedMrr: organizations.contractedMrr,
      hqCity: organizations.hqCity,
      lcAccountIds: organizations.lcAccountIds,
      aeName: ae.name,
      csmName: csm.name,
    })
    .from(organizations)
    .leftJoin(ae, eq(ae.id, organizations.aeId))
    .leftJoin(csm, eq(csm.id, organizations.csmId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(organizations.contractedMrr), asc(organizations.name));
  return { ok: true as const, data: await (f.limit ? query.limit(f.limit) : query) };
}

export async function getOrganizationDetail(id: string) {
  if (!isUuid(id)) return null;
  const data = await getOrganization(id);
  if (!data) return null;
  const { org, deals: orgDeals, contacts: orgContacts, onboardings } = data;
  return { ...org, deals: orgDeals.map((d) => ({ ...d.deal, stage: d.stageName })), contacts: orgContacts, onboardings };
}

// ---------- leads ----------

export const leadFilters = z.object({
  q: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).optional(),
  sdr: z.string().trim().min(1).optional(),
});

const LEAD_STATUS_KEYS = LEAD_STATUSES.map((s) => s.key).join(", ");

/** Leads (contacts with a lead status), most recently updated first (up to 100), with per-status counts. */
export async function searchLeads(input: Record<string, unknown>, caller: ApiCaller) {
  const parsed = leadFilters.safeParse(input);
  if (!parsed.success) return fail(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const f = parsed.data;
  if (f.status && f.status !== "none" && !isLeadStatus(f.status)) return fail(400, `status must be one of ${LEAD_STATUS_KEYS}`);
  const [owner, sdr] = await Promise.all([f.owner && resolveUserRef(f.owner, caller), f.sdr && resolveUserRef(f.sdr, caller)]);
  if (owner && !owner.ok) return owner;
  if (sdr && !sdr.ok) return sdr;
  const { rows, byStatus } = await listLeads({ q: f.q, status: f.status, ownerId: owner ? owner.data.id : undefined, sdrId: sdr ? sdr.data.id : undefined });
  return {
    ok: true as const,
    data: rows.map(({ c, orgName, ownerName, sdrName }) => ({ ...c, bantTotal: bantTotal(c), orgName, ownerName, sdrName })),
    counts: byStatus,
  };
}

export async function getLeadDetail(id: string) {
  if (!isUuid(id)) return null;
  const data = await getLead(id);
  if (!data) return null;
  const { lead, org, deals: orgDeals } = data;
  return {
    ...lead,
    bantTotal: bantTotal(lead),
    org: org ? { id: org.id, name: org.name, lifecycle: org.lifecycle, contractedMrr: org.contractedMrr } : null,
    deals: orgDeals,
  };
}

/** Move a lead to a status as `actor`, with the SDR SOP's requirements. Qualified Meeting / SQL opens a deal. */
export async function changeLeadStatus(actor: User, leadId: string, status: string) {
  const allowed = canWrite(actor.role);
  if (!allowed.ok) return fail(403, allowed.message);
  if (!isLeadStatus(status)) return fail(400, `status must be one of ${LEAD_STATUS_KEYS}`);
  if (!isUuid(leadId)) return fail(404, "Lead not found");
  const res = await setLeadStatus(leadId, status, actor.id);
  if (res.ok) return { ok: true as const, data: { leadId, status, dealId: res.dealId ?? null, dealCreated: res.dealCreated ?? false } };
  if (res.error) return fail(res.error.includes("not found") ? 404 : 400, res.error);
  return fail(422, "Lead status requirements not met", res.missing);
}

// ---------- activities ----------

export const activityInput = z.object({
  type: z.enum(activityType.enumValues),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1).nullish(),
  orgId: z.string().uuid().nullish(),
  dealId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  dueAt: z.iso.datetime({ offset: true }).nullish(),
  completedAt: z.iso.datetime({ offset: true }).nullish(),
});
export type ActivityInput = z.infer<typeof activityInput>;

/**
 * Log an activity (call, meeting, note, ...) as `actor`, who becomes its owner. The organization is
 * taken from the deal or contact when not given. Without `dueAt` it's logged as done now; with only
 * `dueAt` it's an open task.
 */
export async function createActivity(actor: User, input: ActivityInput) {
  const allowed = canWrite(actor.role);
  if (!allowed.ok) return fail(403, allowed.message);
  if (!input.orgId && !input.dealId && !input.contactId) return fail(400, "Give at least one of orgId, dealId or contactId");

  const orgIds = new Set<string>();
  if (input.orgId) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.orgId));
    if (!org) return fail(404, "Organization not found");
    orgIds.add(org.id);
  }
  if (input.dealId) {
    const [deal] = await db.select({ orgId: deals.orgId }).from(deals).where(eq(deals.id, input.dealId));
    if (!deal) return fail(404, "Deal not found");
    orgIds.add(deal.orgId);
  }
  if (input.contactId) {
    const [contact] = await db.select({ orgId: contacts.orgId }).from(contacts).where(eq(contacts.id, input.contactId));
    if (!contact) return fail(404, "Contact not found");
    if (contact.orgId) orgIds.add(contact.orgId);
  }
  if (orgIds.size > 1) return fail(400, "The deal, contact and organization belong to different organizations");

  const completedAt = input.completedAt ? new Date(input.completedAt) : input.dueAt ? null : new Date();
  const [activity] = await db
    .insert(activities)
    .values({
      type: input.type,
      subject: input.subject,
      body: input.body ?? null,
      orgId: [...orgIds][0] ?? null,
      dealId: input.dealId ?? null,
      contactId: input.contactId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      completedAt,
      ownerId: actor.id,
      createdById: actor.id,
    })
    .returning();
  return { ok: true as const, data: activity, status: 201 };
}

// ---------- key management (admin settings page) ----------

export async function listApiKeys() {
  const owner = alias(users, "owner");
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      scopes: apiKeys.scopes,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      ownerName: owner.name,
      ownerEmail: owner.email,
      ownerRole: owner.role,
      ownerActive: owner.isActive,
    })
    .from(apiKeys)
    .innerJoin(owner, eq(owner.id, apiKeys.ownerId))
    .orderBy(sql`${apiKeys.revokedAt} is not null`, desc(apiKeys.createdAt));
}

/** Creates a key and returns it in clear, once. Only its hash is stored. */
export async function createApiKey(input: { name: string; ownerId: string; scopes: ApiScope[] }, actorId: string) {
  const { key, hash, prefix } = generateApiKey();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({ ...input, keyHash: hash, keyPrefix: prefix, createdById: actorId })
      .returning({ id: apiKeys.id });
    await tx.insert(events).values({
      entityType: "api_key",
      entityId: row.id,
      actorId,
      action: "created",
      data: { name: input.name, ownerId: input.ownerId, scopes: input.scopes },
    });
    return { id: row.id, key };
  });
}

export async function revokeApiKey(id: string, actorId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, name: apiKeys.name });
    if (!row) return false;
    await tx.insert(events).values({ entityType: "api_key", entityId: row.id, actorId, action: "revoked", data: { name: row.name } });
    return true;
  });
}
