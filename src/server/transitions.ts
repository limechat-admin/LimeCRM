import { and, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { dealLineItems, deals, onboardings, organizations, stages, type Stage } from "@/db/schema";
import { missingFields, requiredFieldsFor, type MissingField } from "@/domain/gates";
import { recordEvent } from "./events";
import { recomputeOrg } from "./mrr";

export type TransitionResult = { ok: true } | { ok: false; missing: MissingField[]; error?: string };

async function pipelineStages(tx: Tx, pipeline: Stage["pipeline"]) {
  return tx.select().from(stages).where(eq(stages.pipeline, pipeline)).orderBy(stages.position);
}

const statusFor = (kind: Stage["kind"]) => (kind === "won" ? "won" : kind === "lost" ? "lost" : "open");

/**
 * Move a deal to a Sales stage, enforcing the stage gate.
 * Winning a deal is the handoff: it opens the organization's Onboarding record
 * (instead of cloning the deal into another pipeline) and advances the lifecycle.
 */
export async function transitionDeal(dealId: string, stageKey: string, actorId: string): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
    if (!deal) return { ok: false, missing: [], error: "Deal not found" };
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, deal.orgId));
    const all = await pipelineStages(tx, "sales");
    const from = all.find((s) => s.id === deal.stageId)!;
    const target = all.find((s) => s.key === stageKey);
    if (!target) return { ok: false, missing: [], error: `Unknown stage ${stageKey}` };
    if (target.id === deal.stageId) return { ok: true };

    const lineItems = await tx.select().from(dealLineItems).where(eq(dealLineItems.dealId, dealId));
    const missing = missingFields({ deal, lineItems, org }, requiredFieldsFor(all, target));
    if (missing.length) return { ok: false, missing };

    const status = statusFor(target.kind);
    await tx
      .update(deals)
      .set({ stageId: target.id, status, closedAt: status === "open" ? null : new Date() })
      .where(eq(deals.id, dealId));
    await recordEvent(tx, {
      entityType: "deal",
      entityId: dealId,
      orgId: org.id,
      actorId,
      action: "stage_changed",
      data: { from: from.name, to: target.name },
    });

    if (status === "won") await onDealWon(tx, deal, org, actorId);
    await recomputeOrg(tx, org.id);
    return { ok: true };
  });
}

async function onDealWon(
  tx: Tx,
  deal: typeof deals.$inferSelect,
  org: typeof organizations.$inferSelect,
  actorId: string,
) {
  const needsOnboarding = deal.requiresOnboarding;
  if (needsOnboarding) {
    const [open] = await tx
      .select({ id: onboardings.id })
      .from(onboardings)
      .where(and(eq(onboardings.orgId, org.id), isNull(onboardings.completedAt)));
    if (!open) {
      const [first] = await tx
        .select()
        .from(stages)
        .where(and(eq(stages.pipeline, "onboarding"), eq(stages.key, "not_started")));
      const [onb] = await tx
        .insert(onboardings)
        .values({ orgId: org.id, dealId: deal.id, stageId: first.id, omId: org.omId })
        .returning({ id: onboardings.id });
      await recordEvent(tx, {
        entityType: "onboarding",
        entityId: onb.id,
        orgId: org.id,
        actorId,
        action: "created",
        data: { fromDeal: deal.title },
      });
    }
  }

  // Prospects (and win-backs) start onboarding; existing customers stay where they are.
  const next =
    org.lifecycle === "prospect" || org.lifecycle === "churned" ? (needsOnboarding ? "onboarding" : "active") : null;
  if (next) await setLifecycle(tx, org, next, actorId);
}

async function setLifecycle(
  tx: Tx,
  org: Pick<typeof organizations.$inferSelect, "id" | "lifecycle">,
  to: (typeof organizations.$inferSelect)["lifecycle"],
  actorId: string,
) {
  if (org.lifecycle === to) return;
  await tx.update(organizations).set({ lifecycle: to }).where(eq(organizations.id, org.id));
  await recordEvent(tx, {
    entityType: "organization",
    entityId: org.id,
    orgId: org.id,
    actorId,
    action: "lifecycle_changed",
    data: { from: org.lifecycle, to },
  });
}

/** Move an onboarding through its stages. Handing to CS completes it and makes the organization Active. */
export async function transitionOnboarding(onboardingId: string, stageKey: string, actorId: string): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [onb] = await tx.select().from(onboardings).where(eq(onboardings.id, onboardingId));
    if (!onb) return { ok: false, missing: [], error: "Onboarding not found" };
    if (onb.completedAt) return { ok: false, missing: [], error: "Onboarding is already complete" };
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, onb.orgId));
    const all = await pipelineStages(tx, "onboarding");
    const from = all.find((s) => s.id === onb.stageId)!;
    const target = all.find((s) => s.key === stageKey);
    if (!target) return { ok: false, missing: [], error: `Unknown stage ${stageKey}` };
    if (target.id === onb.stageId) return { ok: true };

    const missing = missingFields({ org, onboarding: onb }, requiredFieldsFor(all, target));
    if (missing.length) return { ok: false, missing };

    await tx
      .update(onboardings)
      .set({ stageId: target.id, completedAt: target.kind === "won" ? new Date() : null })
      .where(eq(onboardings.id, onboardingId));
    await recordEvent(tx, {
      entityType: "onboarding",
      entityId: onboardingId,
      orgId: org.id,
      actorId,
      action: "stage_changed",
      data: { from: from.name, to: target.name },
    });

    if (target.kind === "won") await setLifecycle(tx, org, "active", actorId);
    else if (target.kind === "hold") await setLifecycle(tx, org, "on_hold", actorId);
    else if (org.lifecycle === "on_hold") await setLifecycle(tx, org, "onboarding", actorId);
    return { ok: true };
  });
}

export type ChurnInput = {
  churnedAt: string;
  category: NonNullable<(typeof organizations.$inferSelect)["churnCategory"]>;
  reason: string;
  lastBillingDate: string;
};

/** Churn is an organization-level event: ends every live contract and closes any open onboarding. */
export async function churnOrganization(orgId: string, input: ChurnInput, actorId: string): Promise<TransitionResult> {
  const missing: MissingField[] = [];
  if (!input.reason.trim()) missing.push({ key: "org.churn_reason", label: "Churn reason" });
  if (!input.lastBillingDate) missing.push({ key: "org.churn_last_billing_date", label: "Last billing date" });
  if (missing.length) return { ok: false, missing };

  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return { ok: false, missing: [], error: "Organization not found" };
    await tx
      .update(organizations)
      .set({
        churnedAt: input.churnedAt,
        churnCategory: input.category,
        churnReason: input.reason,
        churnLastBillingDate: input.lastBillingDate,
      })
      .where(eq(organizations.id, orgId));
    await tx
      .update(deals)
      .set({ endedAt: input.lastBillingDate })
      .where(and(eq(deals.orgId, orgId), eq(deals.status, "won"), isNull(deals.endedAt)));
    await tx
      .update(onboardings)
      .set({ completedAt: new Date() })
      .where(and(eq(onboardings.orgId, orgId), isNull(onboardings.completedAt)));
    await setLifecycle(tx, org, "churned", actorId);
    await recordEvent(tx, {
      entityType: "organization",
      entityId: orgId,
      orgId,
      actorId,
      action: "churned",
      data: { category: input.category, reason: input.reason, lastBillingDate: input.lastBillingDate },
    });
    await recomputeOrg(tx, orgId);
    return { ok: true };
  });
}
