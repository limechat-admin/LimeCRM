import type { Deal, User } from "@/db/schema";

/**
 * Who may do what. Pure functions so the rules are unit-tested (permissions.test.ts) and the
 * server actions only have to fetch the record and ask.
 *
 * Since LimeCRM is the billing source of truth, anything that changes contracted MRR or the
 * contract on a won deal is Finance/Admin only; Sales owns deals until they're won.
 */

type Role = User["role"];
type DealStatus = Deal["status"];

export const ALLOWED_EMAIL_DOMAIN = "limechat.ai";

/** Deal fields that are part of the signed contract. Locked on won deals. */
export const CONTRACT_FIELDS = ["billingCycle", "currency", "contractStart", "contractRenewal", "contractLink"] as const;

export type Denial = { ok: false; message: string };
export type Decision = { ok: true } | Denial;

const ALLOW: Decision = { ok: true };
const deny = (message: string): Denial => ({ ok: false, message });

export function canWrite(role: Role): Decision {
  return role === "viewer" ? deny("Viewers have read-only access to LimeCRM.") : ALLOW;
}

/** Billing-affecting edits on a won deal: line items, contract fields, reopening it. */
export function canEditWonDealBilling(role: Role): boolean {
  return role === "admin" || role === "finance";
}

/** Adding or removing pricing line items. */
export function canEditLineItems(role: Role, dealStatus: DealStatus): Decision {
  const write = canWrite(role);
  if (!write.ok) return write;
  if (dealStatus === "won" && !canEditWonDealBilling(role)) {
    return deny("This deal is won, so its pricing is the billing record. Only Finance or Admin can change line items.");
  }
  return ALLOW;
}

/** Saving the deal form. `changedFields` are the keys whose values actually differ from the stored deal. */
export function canUpdateDeal(role: Role, dealStatus: DealStatus, changedFields: readonly string[]): Decision {
  const write = canWrite(role);
  if (!write.ok) return write;
  if (dealStatus !== "won" || canEditWonDealBilling(role)) return ALLOW;
  const locked = changedFields.filter((f) => (CONTRACT_FIELDS as readonly string[]).includes(f));
  if (locked.length) {
    return deny(`This deal is won. Only Finance or Admin can change its contract fields (${locked.join(", ")}).`);
  }
  return ALLOW;
}

/** Moving a deal between stages. Taking a deal out of Won changes MRR, so it's billing-gated too. */
export function canMoveDeal(role: Role, dealStatus: DealStatus): Decision {
  const write = canWrite(role);
  if (!write.ok) return write;
  if (dealStatus === "won" && !canEditWonDealBilling(role)) {
    return deny("This deal is won. Only Finance or Admin can move it out of Won.");
  }
  return ALLOW;
}

export function canChurn(role: Role): Decision {
  return role === "cs" || role === "admin" ? ALLOW : deny("Only CS or Admin can mark an organization as churned.");
}

// ---------- sign-in ----------

/** What Google tells us about the person signing in (OIDC claims). */
export type GoogleIdentity = { email?: string | null; emailVerified?: boolean | null; hostedDomain?: string | null };

/**
 * Google Workspace check: the `hd` claim is only set for Workspace accounts, so requiring it
 * (plus a verified address on the same domain) rejects personal Gmail and other workspaces.
 */
export function isWorkspaceIdentity(id: GoogleIdentity): boolean {
  const email = id.email?.toLowerCase() ?? "";
  return id.emailVerified === true && id.hostedDomain === ALLOWED_EMAIL_DOMAIN && email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export type SignInRefusal = "domain" | "not_provisioned" | "inactive";

/** Only existing, active LimeCRM users get in; nobody is auto-provisioned. */
export function signInDecision(id: GoogleIdentity, user: Pick<User, "isActive"> | undefined): SignInRefusal | null {
  if (!isWorkspaceIdentity(id)) return "domain";
  if (!user) return "not_provisioned";
  if (!user.isActive) return "inactive";
  return null;
}
