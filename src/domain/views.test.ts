import { describe, expect, it } from "vitest";
import { cleanViewQuery, isViewModule, viewHref } from "./views";

describe("cleanViewQuery", () => {
  it("keeps only the module's filters, trimmed and in a stable order", () => {
    expect(cleanViewQuery("leads", "?sdrId=u2&junk=1&status=sql&q=%20acme%20")).toBe("q=acme&status=sql&sdrId=u2");
  });
  it("drops empty filters", () => {
    expect(cleanViewQuery("leads", "q=&status=")).toBe("");
  });
});

describe("viewHref", () => {
  it("builds the list URL", () => {
    expect(viewHref("leads", "status=sql")).toBe("/leads?status=sql");
    expect(viewHref("leads", "")).toBe("/leads");
  });
});

describe("isViewModule", () => {
  it("accepts only known lists", () => {
    expect(isViewModule("leads")).toBe(true);
    expect(isViewModule("users")).toBe(false);
  });
});
