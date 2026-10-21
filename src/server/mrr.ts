import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { dealLineItems, deals, organizations } from "@/db/schema";
import { dealTotals } from "@/domain/mrr";

/** Recompute a deal's MRR and one-time fee from its line items, then roll up to the organization. */
export async function recomputeDeal(tx: Tx, dealId: string) {
  const items = await tx.select().from(dealLineItems).where(eq(dealLineItems.dealId, dealId));
  const totals = dealTotals(items);
  const [deal] = await tx.update(deals).set(totals).where(eq(deals.id, dealId)).returning({ orgId: deals.orgId });
  await recomputeOrg(tx, deal.orgId);
  return totals;
}

/** Contracted MRR = MRR of won deals whose contract hasn't ended. Churned organizations are 0. */
export async function recomputeOrg(tx: Tx, orgId: string) {
  const [{ total }] = await tx
    .select({ total: sql<string>`coalesce(sum(${deals.mrr}), 0)` })
    .from(deals)
    .innerJoin(organizations, eq(organizations.id, deals.orgId))
    .where(
      and(
        eq(deals.orgId, orgId),
        eq(deals.status, "won"),
        isNull(deals.endedAt),
        sql`${organizations.lifecycle} <> 'churned'`,
      ),
    );
  await tx.update(organizations).set({ contractedMrr: Number(total) }).where(eq(organizations.id, orgId));
}
