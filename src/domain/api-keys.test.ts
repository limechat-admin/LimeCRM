import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  apiKeyAccess,
  canManageApiKeys,
  generateApiKey,
  hashApiKey,
  hasScope,
  looksLikeApiKey,
  OPERATION_SCOPE,
  scopesFor,
} from "./api-keys";
import { canMoveDeal } from "./permissions";

const ROLES = ["admin", "sales", "onboarding", "cs", "finance", "viewer"] as const;
const READ = ["read"] as ("read" | "write")[];
const WRITE = ["read", "write"] as ("read" | "write")[];
const live = (scopes: ("read" | "write")[]) => ({ scopes, revokedAt: null });
const active = (role: (typeof ROLES)[number]) => ({ role, isActive: true });

describe("key hashing", () => {
  it("hashes with sha256 hex", () => {
    const key = "lcrm_example";
    expect(hashApiKey(key)).toBe(createHash("sha256").update(key).digest("hex"));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique, well-formed keys whose stored parts don't reveal the key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(looksLikeApiKey(a.key)).toBe(true);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).not.toContain(a.key.slice(5));
    expect(a.prefix).toBe(a.key.slice(0, 11));
    expect(a.key.length).toBe(48);
  });

  it("tells keys apart from the legacy shared token", () => {
    expect(looksLikeApiKey("dev-local-token-change-me")).toBe(false);
    expect(looksLikeApiKey(`lcrm_${"a".repeat(42)}`)).toBe(false);
  });
});

describe("scopes", () => {
  it("treats write as including read", () => {
    expect(hasScope(READ, "read")).toBe(true);
    expect(hasScope(READ, "write")).toBe(false);
    expect(hasScope(["write"], "read")).toBe(true);
    expect(hasScope(WRITE, "write")).toBe(true);
    expect(hasScope([], "read")).toBe(false);
  });

  it("maps the settings form choice to stored scopes", () => {
    expect(scopesFor("read")).toEqual(["read"]);
    expect(scopesFor("write")).toEqual(["read", "write"]);
  });
});

describe("apiKeyAccess (key scope × owner role)", () => {
  it("lets any active owner's key read", () => {
    expect(ROLES.filter((r) => apiKeyAccess(live(READ), active(r), "read").ok)).toEqual([...ROLES]);
  });

  it("refuses writes with a read-only key, whatever the owner's role", () => {
    const d = apiKeyAccess(live(READ), active("admin"), "write");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toMatch(/read-only/);
  });

  it("applies the owner's role to write keys: a viewer's key can't write", () => {
    expect(ROLES.filter((r) => apiKeyAccess(live(WRITE), active(r), "write").ok)).toEqual([
      "admin",
      "sales",
      "onboarding",
      "cs",
      "finance",
    ]);
    const d = apiKeyAccess(live(WRITE), active("viewer"), "write");
    expect(!d.ok && d.message).toMatch(/Viewers have read-only access/);
  });

  it("stops revoked keys and keys of deactivated owners, even for reads", () => {
    const revoked = apiKeyAccess({ scopes: WRITE, revokedAt: new Date() }, active("admin"), "read");
    expect(!revoked.ok && revoked.message).toMatch(/revoked/);
    const inactive = apiKeyAccess(live(WRITE), { role: "admin", isActive: false }, "read");
    expect(!inactive.ok && inactive.message).toMatch(/deactivated/);
  });

  it("leaves record rules to the owner's role: a sales key can't move a won deal, a finance key can", () => {
    expect(apiKeyAccess(live(WRITE), active("sales"), "write").ok).toBe(true);
    expect(canMoveDeal("sales", "won").ok).toBe(false);
    expect(canMoveDeal("finance", "won").ok).toBe(true);
  });
});

describe("canManageApiKeys", () => {
  it("is admin only", () => {
    expect(ROLES.filter((r) => canManageApiKeys(r).ok)).toEqual(["admin"]);
  });
});

describe("OPERATION_SCOPE", () => {
  it("needs write for exactly the operations that change data", () => {
    const writes = Object.entries(OPERATION_SCOPE).filter(([, s]) => s === "write").map(([op]) => op);
    expect(writes.sort()).toEqual(["log_activity", "set_lead_status", "update_deal_stage"]);
  });

  it("lets a read-only key call every read operation and none of the writes", () => {
    const allowed = (Object.keys(OPERATION_SCOPE) as (keyof typeof OPERATION_SCOPE)[]).filter(
      (op) => apiKeyAccess(live(READ), active("sales"), OPERATION_SCOPE[op]).ok,
    );
    expect(allowed).not.toContain("update_deal_stage");
    expect(allowed).toContain("search_deals");
    expect(allowed).toHaveLength(8);
  });
});
