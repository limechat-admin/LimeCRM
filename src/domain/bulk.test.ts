import { describe, expect, it } from "vitest";
import { bulkChoice, parseBulkIds, summarizeBulk } from "./bulk";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseBulkIds", () => {
  it("keeps unique ids and drops junk", () => {
    expect(parseBulkIds(`${A}, ${B},${A},not-an-id,`)).toEqual([A, B]);
    expect(parseBulkIds(null)).toEqual([]);
  });
});

describe("bulkChoice", () => {
  it("distinguishes keep, clear and set", () => {
    expect(bulkChoice("")).toEqual({ change: false });
    expect(bulkChoice(null)).toEqual({ change: false });
    expect(bulkChoice("none")).toEqual({ change: true, value: null });
    expect(bulkChoice(A)).toEqual({ change: true, value: A });
  });
});

describe("summarizeBulk", () => {
  it("reports successes and names the first failures", () => {
    expect(summarizeBulk([{ name: "Asha", ok: true }], ["lead", "leads"])).toEqual({ ok: true, message: "Updated 1 lead." });
    const r = summarizeBulk(
      [
        { name: "Asha", ok: true },
        { name: "Ravi", ok: false, why: "Meeting date" },
        { name: "Mei", ok: false, why: "BANT" },
        { name: "Jo", ok: false, why: "BANT" },
        { name: "Kim", ok: false, why: "BANT" },
      ],
      ["lead", "leads"],
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Updated 1 lead. 4 not changed: Ravi (Meeting date), Mei (BANT), Jo (BANT), and 1 more.");
    expect(summarizeBulk([{ name: "Ravi", ok: false, why: "x" }], ["lead", "leads"]).ok).toBe(false);
    expect(summarizeBulk([{ name: "Asha", ok: true }], ["lead", "leads"], { verb: "Moved", suffix: " to SQL" }).message).toBe("Moved 1 lead to SQL.");
    expect(summarizeBulk([{ name: "Ravi", ok: false, why: "BANT" }], ["lead", "leads"], { verb: "Moved" }).message).toBe(
      "Nothing moved. 1 not changed: Ravi (BANT).",
    );
  });
});
