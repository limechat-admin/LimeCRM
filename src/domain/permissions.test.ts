import { describe, expect, it } from "vitest";
import {
  canChurn,
  canEditLineItems,
  canMoveDeal,
  canUpdateDeal,
  canWrite,
  isWorkspaceIdentity,
  signInDecision,
  type GoogleIdentity,
} from "./permissions";

const ROLES = ["admin", "sales", "onboarding", "cs", "finance", "viewer"] as const;
const allowed = (d: { ok: boolean }) => d.ok;
const rolesWhere = (check: (role: (typeof ROLES)[number]) => { ok: boolean }) => ROLES.filter((r) => check(r).ok);

describe("canWrite", () => {
  it("makes viewers read-only and lets every other role write", () => {
    expect(rolesWhere(canWrite)).toEqual(["admin", "sales", "onboarding", "cs", "finance"]);
    const denial = canWrite("viewer");
    expect(denial.ok).toBe(false);
    if (!denial.ok) expect(denial.message).toMatch(/read-only/);
  });
});

describe("canEditLineItems", () => {
  it("lets any writer price an open or lost deal", () => {
    expect(rolesWhere((r) => canEditLineItems(r, "open"))).toEqual(["admin", "sales", "onboarding", "cs", "finance"]);
    expect(rolesWhere((r) => canEditLineItems(r, "lost"))).toEqual(["admin", "sales", "onboarding", "cs", "finance"]);
  });

  it("locks pricing on won deals to admin and finance", () => {
    expect(rolesWhere((r) => canEditLineItems(r, "won"))).toEqual(["admin", "finance"]);
  });

  it("tells viewers they are read-only rather than that the deal is won", () => {
    const d = canEditLineItems("viewer", "won");
    expect(!d.ok && d.message).toMatch(/read-only/);
  });
});

describe("canUpdateDeal", () => {
  it("lets sales edit anything on an open deal, contract fields included", () => {
    expect(allowed(canUpdateDeal("sales", "open", ["contractStart", "billingCycle", "title"]))).toBe(true);
  });

  it("lets sales edit non-contract fields on a won deal", () => {
    expect(allowed(canUpdateDeal("sales", "won", ["title", "ownerId", "products"]))).toBe(true);
    expect(allowed(canUpdateDeal("sales", "won", []))).toBe(true);
  });

  it("blocks non-finance roles from changing contract fields on a won deal and names them", () => {
    for (const role of ["sales", "onboarding", "cs"] as const) {
      const d = canUpdateDeal(role, "won", ["title", "currency", "contractRenewal"]);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.message).toContain("currency, contractRenewal");
    }
  });

  it("lets admin and finance change contract fields on a won deal", () => {
    for (const role of ["admin", "finance"] as const) {
      expect(allowed(canUpdateDeal(role, "won", ["currency", "contractLink", "billingCycle", "contractStart"]))).toBe(true);
    }
  });

  it("blocks viewers even when nothing changed", () => {
    expect(allowed(canUpdateDeal("viewer", "open", []))).toBe(false);
  });
});

describe("canMoveDeal", () => {
  it("lets any writer move an open deal (including winning it)", () => {
    expect(rolesWhere((r) => canMoveDeal(r, "open"))).toEqual(["admin", "sales", "onboarding", "cs", "finance"]);
  });

  it("only lets admin and finance take a deal out of Won", () => {
    expect(rolesWhere((r) => canMoveDeal(r, "won"))).toEqual(["admin", "finance"]);
  });
});

describe("canChurn", () => {
  it("is CS and admin only", () => {
    expect(rolesWhere(canChurn)).toEqual(["admin", "cs"]);
  });
});

describe("sign-in", () => {
  const workspace: GoogleIdentity = { email: "asha@limechat.ai", emailVerified: true, hostedDomain: "limechat.ai" };

  it("accepts a verified limechat.ai Workspace account", () => {
    expect(isWorkspaceIdentity(workspace)).toBe(true);
    expect(isWorkspaceIdentity({ ...workspace, email: "Asha@LimeChat.ai" })).toBe(true);
  });

  it("rejects personal Gmail, other Workspaces, unverified and lookalike addresses", () => {
    expect(isWorkspaceIdentity({ email: "asha@gmail.com", emailVerified: true, hostedDomain: undefined })).toBe(false);
    expect(isWorkspaceIdentity({ email: "asha@limechat.ai", emailVerified: true, hostedDomain: undefined })).toBe(false);
    expect(isWorkspaceIdentity({ email: "asha@acme.com", emailVerified: true, hostedDomain: "acme.com" })).toBe(false);
    expect(isWorkspaceIdentity({ ...workspace, emailVerified: false })).toBe(false);
    expect(isWorkspaceIdentity({ ...workspace, email: "asha@limechat.ai.evil.com" })).toBe(false);
    expect(isWorkspaceIdentity({ ...workspace, email: "asha@notlimechat.ai" })).toBe(false);
    expect(isWorkspaceIdentity({ ...workspace, email: null })).toBe(false);
  });

  it("only admits existing, active users", () => {
    expect(signInDecision(workspace, { isActive: true })).toBeNull();
    expect(signInDecision(workspace, undefined)).toBe("not_provisioned");
    expect(signInDecision(workspace, { isActive: false })).toBe("inactive");
  });

  it("checks the domain before the users table", () => {
    expect(signInDecision({ ...workspace, hostedDomain: "acme.com" }, { isActive: true })).toBe("domain");
  });
});
