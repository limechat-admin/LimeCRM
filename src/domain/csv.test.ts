import { describe, expect, it } from "vitest";
import { csvCell, duplicateEmailsInFile, guessColumns, mapLeadRow, toCsv } from "./csv";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("Acme, Inc")).toBe('"Acme, Inc"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises spreadsheet formulas but leaves numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-5 discount")).toBe("'-5 discount");
    expect(csvCell(-5)).toBe("-5");
  });

  it("joins arrays and blanks nulls", () => {
    expect(csvCell(["Chat BOT", "Voice BOT"])).toBe('"Chat BOT, Voice BOT"');
    expect(csvCell(null)).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a BOM, a header row and CRLF lines", () => {
    const out = toCsv([{ n: "A", v: 1 }], [
      { header: "Name", value: (r) => r.n },
      { header: "Value", value: (r) => r.v },
    ]);
    expect(out).toBe("﻿Name,Value\r\nA,1\r\n");
  });
});

describe("guessColumns", () => {
  it("matches common header spellings regardless of case and punctuation", () => {
    const map = guessColumns(["Full Name", "Work Email", "Company Name", "Job Title", "Mobile", "Website URL", "SDR Email"]);
    expect(map).toEqual({
      name: "Full Name",
      email: "Work Email",
      companyName: "Company Name",
      designation: "Job Title",
      phone: "Mobile",
      website: "Website URL",
      sdrEmail: "SDR Email",
    });
  });

  it("doesn't map one column twice", () => {
    const map = guessColumns(["Name", "Contact"]);
    expect(map.name).toBe("Name");
  });
});

describe("mapLeadRow", () => {
  const map = { name: "Name", email: "Email", companyName: "Company", website: "Site" };

  it("cleans and normalises a good row", () => {
    const r = mapLeadRow({ Name: " Asha ", Email: "ASHA@Brand.in", Company: "Brand", Site: "brand.in" }, map, 1, "Sheet Allocation (Outbound)");
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({ name: "Asha", email: "asha@brand.in", website: "https://brand.in", source: "Sheet Allocation (Outbound)" });
  });

  it("rejects rows without a name or company, and bad emails", () => {
    const r = mapLeadRow({ Name: "", Email: "not-an-email", Company: "" }, map, 7, null);
    expect(r.data).toBeNull();
    expect(r.errors).toEqual(["Name is empty", "Company is empty", '"not-an-email" isn\'t an email address']);
  });
});

describe("duplicateEmailsInFile", () => {
  it("flags later repeats of the same email", () => {
    const rows = [1, 2, 3].map((row) => mapLeadRow({ Name: "X", Company: "Y", Email: row === 2 ? "b@x.in" : "a@x.in" }, { name: "Name", companyName: "Company", email: "Email" }, row, null));
    expect([...duplicateEmailsInFile(rows)]).toEqual([3]);
  });
});
