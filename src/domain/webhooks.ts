/** Outbound webhooks: which LimeCRM changes become which events, and how deliveries are signed. Pure. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ALL_EVENTS, WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events";

export { ALL_EVENTS, WEBHOOK_EVENTS, type WebhookEvent };

const ENTITY_PREFIX: Record<string, string> = { deal: "deal", organization: "organization", onboarding: "onboarding", contact: "lead" };
const ACTION_SUFFIX: Record<string, string> = {
  created: "created",
  updated: "updated",
  stage_changed: "stage_changed",
  line_item_added: "pricing_changed",
  line_item_removed: "pricing_changed",
  lifecycle_changed: "lifecycle_changed",
  churned: "churned",
  lead_status_changed: "status_changed",
  merged: "merged",
};
const KNOWN = new Set<string>(WEBHOOK_EVENTS.map((e) => e.key));

/** The webhook event for an audit-log entry, or null for changes that aren't published (API keys, …). */
export function webhookEventFor(entityType: string, action: string): WebhookEvent | null {
  const prefix = ENTITY_PREFIX[entityType];
  const suffix = ACTION_SUFFIX[action];
  const name = prefix && suffix ? `${prefix}.${suffix}` : null;
  return name && KNOWN.has(name) ? (name as WebhookEvent) : null;
}

export function subscribes(events: string[], event: WebhookEvent) {
  return event === "ping" || events.includes(ALL_EVENTS) || events.includes(event);
}

export const generateWebhookSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

/**
 * `X-LimeCRM-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the secret>`.
 * Same scheme as Stripe's, so consumers can check freshness (t) and authenticity (v1).
 */
export function signatureHeader(secret: string, body: string, at = new Date()) {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** What a consumer runs: true if the header matches the body and is at most `toleranceSec` old. */
export function verifySignature(secret: string, body: string, header: string, now = new Date(), toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now.getTime() / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Endpoints must be https. Plain http is allowed only for localhost, and only outside production. */
export function endpointUrlProblem(raw: string, { production }: { production: boolean }): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, like https://accountpulse.example.com/hooks/limecrm";
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && local && !production) return null;
  return local ? "Use https in production" : "The URL must start with https://";
}

/** Backoff for failed deliveries: 1, 4, 16, 64, 256 minutes, then give up (about 5½ hours in all). */
export const WEBHOOK_MAX_ATTEMPTS = 6;
export const webhookRetryMinutes = (attempts: number) => 4 ** Math.max(0, attempts - 1);
