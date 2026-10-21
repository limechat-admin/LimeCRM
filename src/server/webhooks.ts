/**
 * Outbound webhooks. recordEvent() calls enqueueWebhooks() inside the same transaction as the
 * change, so a delivery exists exactly when the change committed. Deliveries are sent right after
 * the request and retried by the dispatch cron. Payloads are thin (ids, what changed and links);
 * consumers fetch the full record from /api/v1 with their API key.
 */
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, type Tx } from "@/db";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import {
  endpointUrlProblem,
  generateWebhookSecret,
  signatureHeader,
  subscribes,
  WEBHOOK_MAX_ATTEMPTS,
  webhookEventFor,
  webhookRetryMinutes,
  type WebhookEvent,
} from "@/domain/webhooks";

type AuditEntry = { entityType: string; entityId: string; orgId: string | null; actorId: string | null; action: string; data?: Record<string, unknown> };

const API_PATH: Record<string, string> = { deal: "deals", organization: "organizations", contact: "leads" };
const APP_PATH: Record<string, string> = { deal: "deals", organization: "companies", contact: "leads" };

function links(e: AuditEntry) {
  const base = process.env.APP_URL || "http://localhost:3000";
  const id = e.entityType === "onboarding" ? e.orgId : e.entityId;
  const kind = e.entityType === "onboarding" ? "organization" : e.entityType;
  return { api: id && API_PATH[kind] ? `${base}/api/v1/${API_PATH[kind]}/${id}` : null, app: id && APP_PATH[kind] ? `${base}/${APP_PATH[kind]}/${id}` : null };
}

export function webhookPayload(event: WebhookEvent, e: AuditEntry, at = new Date()) {
  return {
    event,
    occurredAt: at.toISOString(),
    data: { entityType: e.entityType === "contact" ? "lead" : e.entityType, id: e.entityId, orgId: e.orgId, actorId: e.actorId, changes: e.data ?? {} },
    links: links(e),
  };
}

/** Queue one delivery per active endpoint that subscribes to this change. Returns how many. */
export async function enqueueWebhooks(tx: Tx, e: AuditEntry): Promise<number> {
  const event = webhookEventFor(e.entityType, e.action);
  if (!event) return 0;
  const endpoints = await tx.select({ id: webhookEndpoints.id, events: webhookEndpoints.events }).from(webhookEndpoints).where(eq(webhookEndpoints.isActive, true));
  const targets = endpoints.filter((ep) => subscribes(ep.events, event));
  if (!targets.length) return 0;
  const payload = webhookPayload(event, e);
  await tx.insert(webhookDeliveries).values(targets.map((ep) => ({ endpointId: ep.id, event, payload })));
  kickWebhooks();
  return targets.length;
}

async function deliver(d: typeof webhookDeliveries.$inferSelect, ep: typeof webhookEndpoints.$inferSelect) {
  const body = JSON.stringify({ id: d.id, ...d.payload });
  const res = await fetch(ep.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "LimeCRM-Webhooks/1",
      "X-LimeCRM-Event": d.event,
      "X-LimeCRM-Delivery": d.id,
      "X-LimeCRM-Signature": signatureHeader(ep.secret, body),
    },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

/** Send what's due; failures retry with backoff. Paused or deleted endpoints are skipped. */
export async function dispatchWebhooks(limit = 50) {
  const due = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, sql`now()`)))
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(limit);
  const results = { sent: 0, skipped: 0, failed: 0 };
  for (const { id } of due) {
    const [d] = await db
      .update(webhookDeliveries)
      .set({ status: "sending", attempts: sql`${webhookDeliveries.attempts} + 1` })
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.status, "pending")))
      .returning();
    if (!d) continue;
    const [ep] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, d.endpointId));
    if (!ep?.isActive) {
      await db.update(webhookDeliveries).set({ status: "skipped", lastError: "Endpoint paused" }).where(eq(webhookDeliveries.id, id));
      results.skipped++;
      continue;
    }
    let status: number | null = null;
    let error: string | null = null;
    try {
      status = await deliver(d, ep);
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (e) {
      error = e instanceof Error ? (e.name === "TimeoutError" ? "Timed out after 10s" : e.message) : String(e);
    }
    if (!error) {
      await db.update(webhookDeliveries).set({ status: "sent", responseStatus: status, lastError: null, sentAt: new Date() }).where(eq(webhookDeliveries.id, id));
      results.sent++;
      continue;
    }
    // 4xx other than 408/429 means the consumer rejected it; retrying won't help.
    const permanent = status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
    const giveUp = permanent || d.attempts >= WEBHOOK_MAX_ATTEMPTS;
    await db
      .update(webhookDeliveries)
      .set({
        status: giveUp ? "failed" : "pending",
        responseStatus: status,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + webhookRetryMinutes(d.attempts) * 60_000),
      })
      .where(eq(webhookDeliveries.id, id));
    results.failed++;
  }
  return results;
}

/** Send right after the current request; outside a request (scripts, tests) the cron picks them up. */
export function kickWebhooks() {
  try {
    after(() => dispatchWebhooks().catch((e) => console.error("webhook dispatch failed", e)));
  } catch {
    // Not in a request.
  }
}

// ---------- management (Settings → Webhooks, admin only) ----------

export async function listWebhookEndpoints() {
  const endpoints = await db.select().from(webhookEndpoints).orderBy(asc(webhookEndpoints.createdAt));
  const last = await db
    .selectDistinctOn([webhookDeliveries.endpointId], {
      endpointId: webhookDeliveries.endpointId,
      status: webhookDeliveries.status,
      at: webhookDeliveries.createdAt,
      responseStatus: webhookDeliveries.responseStatus,
    })
    .from(webhookDeliveries)
    .orderBy(webhookDeliveries.endpointId, desc(webhookDeliveries.createdAt));
  return endpoints.map(({ secret, ...ep }) => ({ ...ep, secretHint: `${secret.slice(0, 10)}…`, last: last.find((l) => l.endpointId === ep.id) ?? null }));
}

export async function recentDeliveries(limit = 50) {
  return db
    .select({ d: webhookDeliveries, endpoint: webhookEndpoints.name })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}

export type NewEndpoint = { name: string; url: string; events: string[] };

/** Returns the signing secret in clear; it's shown once on creation. */
export async function createWebhookEndpoint(input: NewEndpoint, actorId: string) {
  const problem = endpointUrlProblem(input.url, { production: process.env.NODE_ENV === "production" });
  if (problem) return { ok: false as const, message: problem };
  if (!input.events.length) return { ok: false as const, message: "Pick at least one event" };
  const secret = generateWebhookSecret();
  const [row] = await db.insert(webhookEndpoints).values({ ...input, secret, createdById: actorId }).returning({ id: webhookEndpoints.id });
  return { ok: true as const, id: row.id, secret };
}

export async function setWebhookActive(id: string, isActive: boolean) {
  const rows = await db.update(webhookEndpoints).set({ isActive }).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
  return rows.length > 0;
}

export async function deleteWebhookEndpoint(id: string) {
  const rows = await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
  return rows.length > 0;
}

/** Queue a `ping` to one endpoint and send it now. */
export async function pingWebhook(id: string, actorId: string) {
  const [ep] = await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  if (!ep) return false;
  const payload = webhookPayload("ping", { entityType: "webhook", entityId: id, orgId: null, actorId, action: "ping", data: { message: "Test delivery from LimeCRM" } });
  await db.insert(webhookDeliveries).values({ endpointId: id, event: "ping", payload });
  await dispatchWebhooks(10);
  return true;
}
