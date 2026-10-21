import { describe, expect, it } from "vitest";
import { endpointUrlProblem, generateWebhookSecret, signatureHeader, subscribes, verifySignature, webhookEventFor, webhookRetryMinutes } from "./webhooks";

describe("webhookEventFor", () => {
  it("maps audit-log entries to events", () => {
    expect(webhookEventFor("deal", "stage_changed")).toBe("deal.stage_changed");
    expect(webhookEventFor("deal", "line_item_added")).toBe("deal.pricing_changed");
    expect(webhookEventFor("contact", "lead_status_changed")).toBe("lead.status_changed");
    expect(webhookEventFor("organization", "churned")).toBe("organization.churned");
  });
  it("publishes nothing for internal records or unknown actions", () => {
    expect(webhookEventFor("api_key", "created")).toBeNull();
    expect(webhookEventFor("api_key", "revoked")).toBeNull();
    expect(webhookEventFor("deal", "churned")).toBeNull();
  });
});

describe("subscribes", () => {
  it("honours the event list, * and ping", () => {
    expect(subscribes(["deal.stage_changed"], "deal.stage_changed")).toBe(true);
    expect(subscribes(["deal.stage_changed"], "deal.updated")).toBe(false);
    expect(subscribes(["*"], "lead.created")).toBe(true);
    expect(subscribes([], "ping")).toBe(true);
  });
});

describe("signatures", () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify({ event: "deal.updated" });
  const at = new Date("2026-10-22T10:00:00Z");

  it("round-trips", () => {
    expect(secret).toMatch(/^whsec_/);
    expect(verifySignature(secret, body, signatureHeader(secret, body, at), at)).toBe(true);
  });
  it("rejects a changed body, the wrong secret or a stale timestamp", () => {
    const header = signatureHeader(secret, body, at);
    expect(verifySignature(secret, body + " ", header, at)).toBe(false);
    expect(verifySignature(generateWebhookSecret(), body, header, at)).toBe(false);
    expect(verifySignature(secret, body, header, new Date(at.getTime() + 10 * 60_000))).toBe(false);
    expect(verifySignature(secret, body, "garbage", at)).toBe(false);
  });
});

describe("endpointUrlProblem", () => {
  it("wants https, except localhost in dev", () => {
    expect(endpointUrlProblem("https://pulse.limechat.ai/hooks", { production: true })).toBeNull();
    expect(endpointUrlProblem("http://pulse.limechat.ai/hooks", { production: false })).toMatch(/https/);
    expect(endpointUrlProblem("http://localhost:4000/hook", { production: false })).toBeNull();
    expect(endpointUrlProblem("http://localhost:4000/hook", { production: true })).toMatch(/production/);
    expect(endpointUrlProblem("pulse.limechat.ai", { production: false })).toMatch(/full URL/);
  });
});

it("backs off 1, 4, 16 … minutes", () => {
  expect([1, 2, 3, 4, 5].map(webhookRetryMinutes)).toEqual([1, 4, 16, 64, 256]);
});
