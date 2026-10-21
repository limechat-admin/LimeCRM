import { describe, expect, it } from "vitest";
import { churnedMessage, clientChannelName, dailyDigestMessage, dealWonMessage, esc, renewalDueMessage, retryDelayMinutes } from "./notify";

describe("clientChannelName", () => {
  it("follows the client-o-<company> SOP with Slack-safe characters", () => {
    expect(clientChannelName("Kumkum Naturals")).toBe("client-o-kumkum-naturals");
    expect(clientChannelName("(Pepe jeans) GOAT Brand Labs")).toBe("client-o-pepe-jeans-goat-brand-labs");
    expect(clientChannelName("Café & Co.")).toBe("client-o-cafe-and-co");
  });

  it("caps the name at Slack's 80 characters without a trailing dash", () => {
    const name = clientChannelName("a".repeat(70) + " bbbbbbbbbbbb");
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith("-")).toBe(false);
  });
});

describe("messages", () => {
  it("escapes user text so it can't inject Slack markup", () => {
    expect(esc("<!channel> & co")).toBe("&lt;!channel&gt; &amp; co");
    const msg = dealWonMessage({ url: "https://crm/deals/1", title: "<!here> Acme", company: "Acme", mrr: 15000, oneTimeFee: 0, owner: "Riya" });
    expect(JSON.stringify(msg.blocks)).not.toContain("<!here>");
  });

  it("summarises a win with MRR in INR", () => {
    const msg = dealWonMessage({ url: "u", title: "Acme - Voice", company: "Acme", mrr: 22800, oneTimeFee: 25000, owner: "Riya", sdr: "Sana", products: ["Voice BOT"] });
    expect(msg.text).toBe("Won: Acme - Voice, ₹22,800/mo");
    expect(JSON.stringify(msg.blocks)).toContain("₹25,000 one-time");
  });

  it("states churned MRR as lost", () => {
    expect(churnedMessage({ url: "u", company: "Acme", mrr: 75000, category: "Payment" }).text).toBe("Churned: Acme, ₹75,000/mo");
  });

  it("words renewal timing naturally", () => {
    const base = { url: "u", company: "Acme", deal: "Acme - Chat", renewalDate: "2026-11-20", mrr: 1000, owner: null };
    expect(JSON.stringify(renewalDueMessage({ ...base, daysLeft: 1 }).blocks)).toContain("in *1 day*");
    expect(JSON.stringify(renewalDueMessage({ ...base, daysLeft: 0 }).blocks)).toContain("*today*");
  });
});

describe("dailyDigestMessage", () => {
  it("sends nothing on a clear day", () => {
    expect(dailyDigestMessage({ name: "Riya", overdue: [], today: [], stale: [], workUrl: "w" })).toBeNull();
  });

  it("lists at most 8 items per section", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ label: `T${i}`, url: "u", detail: "d" }));
    const msg = dailyDigestMessage({ name: "Riya Kapoor", overdue: items, today: [], stale: [], workUrl: "w" })!;
    expect(msg.text).toBe("Good morning Riya Kapoor: 10 overdue, 0 due today, 0 quiet deals");
    expect(JSON.stringify(msg.blocks)).toContain("…and 2 more");
  });
});

describe("retryDelayMinutes", () => {
  it("backs off 1, 4, 16, 64 minutes", () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([1, 4, 16, 64]);
  });
});
