import { describe, expect, it } from "vitest";
import { activitySubject, companyNameFromDomain, contactNameFor, parseAddressList, planMessage, trimSnippet, type MailHeaders } from "./mail";

const ctx = { mailbox: "kopal@limechat.ai", internalDomains: ["limechat.ai"], exclusions: ["vendor.com", "friend@gmail.com"] };
const base: MailHeaders = {
  from: "Kopal <kopal@limechat.ai>",
  to: '"Nair, Priya" <Priya@Tealeaf.in>',
  cc: "anand@limechat.ai",
  subject: "Proposal",
  date: "Wed, 21 Oct 2026 10:15:00 +0530",
  messageId: "<abc@mail.gmail.com>",
};

describe("parseAddressList", () => {
  it("handles quoted commas, angle brackets and bare addresses", () => {
    expect(parseAddressList('"Nair, Priya" <Priya@Tealeaf.in>, ops@acme.com , Bad Entry')).toEqual([
      { email: "priya@tealeaf.in", name: "Nair, Priya" },
      { email: "ops@acme.com", name: null },
    ]);
  });
});

describe("planMessage", () => {
  it("logs a rep's email to an outside person as outbound, with internal people left out", () => {
    const p = planMessage(base, ctx);
    expect(p).toMatchObject({ log: true, direction: "outbound", externals: [{ email: "priya@tealeaf.in", name: "Nair, Priya" }], subject: "Proposal" });
  });
  it("logs a reply from outside as inbound", () => {
    const p = planMessage({ ...base, from: "Priya <priya@tealeaf.in>", to: "kopal@limechat.ai", cc: null }, ctx);
    expect(p).toMatchObject({ log: true, direction: "inbound", externals: [{ email: "priya@tealeaf.in" }] });
  });
  it("skips internal-only, newsletters, automated senders, mass mail and never-log people", () => {
    expect(planMessage({ ...base, to: "anand@limechat.ai" }, ctx)).toEqual({ log: false, reason: "internal" });
    expect(planMessage({ ...base, from: "News <news@brand.com>", to: "kopal@limechat.ai", listUnsubscribe: "<mailto:u@brand.com>" }, ctx)).toEqual({
      log: false,
      reason: "bulk",
    });
    expect(planMessage({ ...base, from: "no-reply@razorpay.com", to: "kopal@limechat.ai" }, ctx)).toEqual({ log: false, reason: "automated" });
    expect(planMessage({ ...base, to: Array.from({ length: 21 }, (_, i) => `p${i}@x.com`).join(", ") }, ctx)).toEqual({ log: false, reason: "bulk" });
    expect(planMessage({ ...base, to: "sales@vendor.com, friend@gmail.com" }, ctx)).toEqual({ log: false, reason: "excluded" });
  });
  it("needs a date", () => {
    expect(planMessage({ ...base, date: "not a date" }, ctx)).toEqual({ log: false, reason: "no_date" });
  });
});

describe("names", () => {
  it("names contacts from the header or the address", () => {
    expect(contactNameFor({ email: "priya.nair@tealeaf.in", name: null })).toBe("Priya Nair");
    expect(contactNameFor({ email: "x@y.com", name: "  Priya   Nair " })).toBe("Priya Nair");
  });
  it("names companies from their domain", () => {
    expect(companyNameFromDomain("tealeaf-organics.co.in")).toBe("Tealeaf Organics");
    expect(companyNameFromDomain("acme.com")).toBe("Acme");
    expect(companyNameFromDomain("shop.boat-lifestyle.com")).toBe("Boat Lifestyle");
  });
});

it("labels direction and trims snippets", () => {
  const p = planMessage(base, ctx);
  if (!p.log) throw new Error("expected a logged message");
  expect(activitySubject(p)).toBe("Sent: Proposal");
  expect(trimSnippet("a".repeat(300))).toHaveLength(240);
});
