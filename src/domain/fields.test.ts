import { describe, expect, it } from "vitest";
import { matchOption, normalizeEmail, normalizePhone, normalizeWebsite, PICKLIST, PICKLISTS, standardize, tidyName } from "./fields";

describe("matchOption", () => {
  const source = PICKLIST.source;
  it("ignores case, spacing and punctuation", () => {
    expect(matchOption("paid-ads", source.seeds, source.aliases)).toBe("Paid Ads");
    expect(matchOption("  SELF GENERATION ", source.seeds, source.aliases)).toBe("Self Generation");
    expect(matchOption("ai sdr", source.seeds, source.aliases)).toBe("AI SDR");
  });
  it("uses aliases, and only when the alias target is a current value", () => {
    expect(matchOption("PPC", source.seeds, source.aliases)).toBe("Paid Ads");
    expect(matchOption("PPC", ["Inbound"], source.aliases)).toBeNull();
  });
  it("returns null for empty or unknown values", () => {
    expect(matchOption("", source.seeds)).toBeNull();
    expect(matchOption("carrier pigeon", source.seeds, source.aliases)).toBeNull();
  });
  it("matches Salesmate's traffic bands and partner spellings", () => {
    const t = PICKLIST.traffic_band;
    expect(matchOption("150k-299K", t.seeds, t.aliases)).toBe("150K–299K");
    expect(matchOption("0-10k", t.seeds, t.aliases)).toBe("0–10K");
    expect(matchOption("More than 3M", t.seeds, t.aliases)).toBe("3M+");
    const p = PICKLIST.partner;
    expect(matchOption("Marmetto", p.seeds, p.aliases)).toBe("Marmeto");
    expect(matchOption("Clevertap", p.seeds, p.aliases)).toBe("CleverTap");
  });
});

describe("standardize", () => {
  it("maps, de-duplicates and reports unknowns", () => {
    const p = PICKLIST.products;
    expect(standardize(p, p.seeds, ["chat", "Chat BOT", "voice", "Smoke signals"])).toEqual({ values: ["Chat BOT", "Voice BOT"], unknown: ["Smoke signals"] });
  });
});

describe("seeds", () => {
  it("never alias to a value that isn't seeded", () => {
    for (const p of PICKLISTS) {
      for (const target of Object.values(p.aliases ?? {})) expect([...p.seeds, ...(p.retiredSeeds ?? [])]).toContain(target);
    }
  });
});

describe("normalizeWebsite", () => {
  it("keeps just the domain", () => {
    expect(normalizeWebsite("https://www.Acme.in/about?x=1")).toBe("acme.in");
    expect(normalizeWebsite("shop.acme.com:8080/")).toBe("shop.acme.com");
    expect(normalizeWebsite("acme")).toBeNull();
    expect(normalizeWebsite(" ")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases and rejects non-emails", () => {
    expect(normalizeEmail(" Priya@Tealeaf.IN ")).toBe("priya@tealeaf.in");
    expect(normalizeEmail("priya at tealeaf")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("turns Indian mobiles into E.164", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91-98765-43210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });
  it("keeps other countries' codes and leaves ambiguous numbers as typed", () => {
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizePhone("022 2345  6789")).toBe("022 2345 6789");
  });
});

it("tidies names without changing their case", () => {
  expect(tidyName("  boAt   Lifestyle ")).toBe("boAt Lifestyle");
});
