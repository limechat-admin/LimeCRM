import { describe, expect, it } from "vitest";
import { blockedReason, campaignRates, describeFilters, fillTokens, listFiltersSchema, renderEmail, safeUrl, type Block } from "./campaigns";

const footer = {
  companyLine: "LimeChat",
  address: "Bengaluru, India",
  unsubscribeUrl: "https://crm.example/u/T?all=1",
  preferencesUrl: "https://crm.example/u/T",
  reason: "You're receiving this because you talked to LimeChat.",
};
const vars = { first_name: "Priya", name: "Priya Nair", company: "Tealeaf", email: "priya@tealeaf.in", ae_name: "Kopal", sender_name: "Kopal" };

describe("fillTokens", () => {
  it("fills tokens, uses fallbacks for empty values and leaves unknown tokens alone", () => {
    expect(fillTokens("Hi {{first_name}} at {{ company }}", vars)).toBe("Hi Priya at Tealeaf");
    expect(fillTokens("Hi {{first_name|there}}", { ...vars, first_name: "" })).toBe("Hi there");
    expect(fillTokens("{{unknown}} {{ae_name|your AE}}", { ae_name: "" })).toBe("{{unknown}} your AE");
  });
});

describe("renderEmail", () => {
  const blocks: Block[] = [
    { type: "heading", text: "Hi {{first_name}}," },
    { type: "text", text: "Read **this** and [our guide](https://limechat.ai/guide).\n\n<script>alert(1)</script> https://limechat.ai" },
    { type: "button", label: "Book", url: "javascript:alert(1)" },
    { type: "divider" },
  ];
  const r = renderEmail({ subject: "For {{company}}", preheader: "Quick note", blocks, logoUrl: "https://crm.example/brand/logo.png" }, vars, footer);

  it("personalises the subject and body", () => {
    expect(r.subject).toBe("For Tealeaf");
    expect(r.html).toContain("Hi Priya,");
    expect(r.text).toContain("Hi Priya,");
  });
  it("escapes HTML and neutralises unsafe links", () => {
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).not.toContain("javascript:");
    expect(r.html).toContain('<a href="#"');
  });
  it("supports bold, links and bare URLs", () => {
    expect(r.html).toContain("<strong>this</strong>");
    expect(r.html).toContain('href="https://limechat.ai/guide"');
    expect(r.text).toContain("our guide (https://limechat.ai/guide)");
  });
  it("always carries the unsubscribe and preference links and the address", () => {
    for (const s of [r.html, r.text]) {
      expect(s).toContain("https://crm.example/u/T?all=1");
      expect(s).toContain("Bengaluru, India");
    }
    expect(r.html).toContain("Quick note");
  });
});

it("allows only http(s) and mailto links", () => {
  expect(safeUrl("https://x.com")).toBe("https://x.com");
  expect(safeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  expect(safeUrl("data:text/html,hi")).toBe("#");
});

describe("blockedReason", () => {
  it("puts suppression first, then unsubscribe-all, then the type", () => {
    expect(blockedReason(undefined, "events")).toBeNull();
    expect(blockedReason({ unsubscribedAll: false, optedOut: ["offers"], suppressed: null }, "events")).toBeNull();
    expect(blockedReason({ unsubscribedAll: false, optedOut: ["events"], suppressed: null }, "events")).toBe("Unsubscribed from this type");
    expect(blockedReason({ unsubscribedAll: true, optedOut: [], suppressed: "hard_bounce" }, "events")).toBe("Address bounced");
  });
});

it("parses list filters with defaults and describes them", () => {
  const f = listFiltersSchema.parse({ sources: ["Inbound"], reconnectDueBy: "2026-11-30" });
  expect(f.audience).toBe("leads");
  expect(describeFilters(f, () => "")).toBe("Leads · source: Inbound · reconnect due by 2026-11-30");
});

it("computes rates against the right base", () => {
  const r = campaignRates({
    recipients: 110,
    sent: 100,
    delivered: 90,
    opened: 45,
    clicked: 9,
    bounced: 10,
    complained: 0,
    unsubscribed: 1,
    skipped: 10,
    failed: 0,
  });
  expect(r).toMatchObject({ delivery: 0.9, open: 0.5, click: 0.1, clickToOpen: 0.2, bounce: 0.1 });
});
