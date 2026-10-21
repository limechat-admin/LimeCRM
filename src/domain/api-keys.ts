import { createHash, randomBytes } from "node:crypto";
import type { ApiKey, User } from "@/db/schema";
import { canWrite, type Decision } from "./permissions";

/**
 * Per-consumer API keys (AccountPulse, CS dashboard, collections agent, AI SDR, Claude via MCP).
 * Pure functions so the rules are unit-tested (api-keys.test.ts); src/server/api.ts does the lookup.
 *
 * A key never has more power than its owner: calls act as the owner user, so the same role rules
 * as the UI apply on top of the key's scope. Only the sha256 of a key is stored.
 */

export type ApiScope = ApiKey["scopes"][number];
export const API_SCOPES = ["read", "write"] as const satisfies readonly ApiScope[];

/** Visible prefix so a leaked key is easy to recognise (and to grep for in logs and repos). */
export const API_KEY_PREFIX = "lcrm_";
/** How much of the key is stored in clear to tell keys apart in the settings page. */
const DISPLAY_LENGTH = API_KEY_PREFIX.length + 6;

export const hashApiKey = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

export const looksLikeApiKey = (token: string) => /^lcrm_[A-Za-z0-9_-]{43}$/.test(token);

/** A new key (256 random bits). `key` is shown to the admin once; only `hash` and `prefix` are stored. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, hash: hashApiKey(key), prefix: key.slice(0, DISPLAY_LENGTH) };
}

/** `write` includes `read`: a consumer that moves deals has to be able to look them up. */
export function hasScope(scopes: readonly ApiScope[], needed: ApiScope): boolean {
  return needed === "read" ? scopes.includes("read") || scopes.includes("write") : scopes.includes("write");
}

/** Scopes from the settings form: "read" or "write" (read and write). */
export const scopesFor = (access: ApiScope): ApiScope[] => (access === "write" ? ["read", "write"] : ["read"]);

type KeyForAccess = Pick<ApiKey, "scopes" | "revokedAt">;
type Owner = Pick<User, "role" | "isActive">;

const deny = (message: string): Decision => ({ ok: false, message });

/**
 * Can this key make a call needing `needed`? Revoked keys and keys of deactivated owners stop
 * working at once; write keys owned by viewers are still read-only, because the owner is.
 * Record-specific rules (won-deal billing, churn) are checked per call with the owner's role.
 */
export function apiKeyAccess(key: KeyForAccess, owner: Owner, needed: ApiScope): Decision {
  if (key.revokedAt) return deny("This API key has been revoked.");
  if (!owner.isActive) return deny("This API key's owner has been deactivated in LimeCRM.");
  if (!hasScope(key.scopes, needed)) return deny("This API key is read-only. Ask an admin for a key with write access.");
  if (needed === "write") return canWrite(owner.role);
  return { ok: true };
}

/** Only admins create, see and revoke API keys: a key can act as anyone. */
export function canManageApiKeys(role: User["role"]): Decision {
  return role === "admin" ? { ok: true } : deny("Only admins can manage API keys.");
}

/** What each API/MCP operation needs. Everything that changes data is `write`. */
export const OPERATION_SCOPE = {
  search_deals: "read",
  get_deal: "read",
  get_deal_line_items: "read",
  update_deal_stage: "write",
  search_organizations: "read",
  get_organization: "read",
  search_leads: "read",
  get_lead: "read",
  set_lead_status: "write",
  log_activity: "write",
  list_users: "read",
} as const satisfies Record<string, ApiScope>;

export type ApiOperation = keyof typeof OPERATION_SCOPE;
