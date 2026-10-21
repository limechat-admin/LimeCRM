/** Reconciliation: LimeCRM's active customer book vs Salesmate's CS "Active Deals". */
import { inr, lakh } from "./lib/util";
import type { Plan } from "./plan";

/** What Salesmate showed in the UI on the day the teardown was written (docs/salesmate-inventory.md §2). */
export const SALESMATE_REFERENCE = { date: "2026-10-20", deals: 280, mrr: 6_570_000 };

export type ActiveOrgRow = { orgId: string; name: string; segment: string; csm: string; mrr: number };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const delta = (n: number) => (Math.abs(n) < 0.5 ? "0" : `${n > 0 ? "+" : "−"}${lakh(Math.abs(n)).slice(1)}`);
const pct = (a: number, b: number) => (b ? `${((a / b - 1) * 100).toFixed(1)}%` : "n/a");

function table(head: string[], rows: (string | number)[][]) {
  return [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function breakdown(plan: Plan, active: ActiveOrgRow[], smKey: (r: Plan["baseline"][number]) => string, lcKey: (r: ActiveOrgRow) => string) {
  const keys = [...new Set([...plan.baseline.map(smKey), ...active.map(lcKey)])];
  const rows = keys.map((k) => {
    const sm = plan.baseline.filter((r) => smKey(r) === k);
    const lc = active.filter((r) => lcKey(r) === k);
    const smMrr = sum(sm.map((r) => r.value));
    const lcMrr = sum(lc.map((r) => r.mrr));
    return { k, smN: sm.length, smMrr, lcN: lc.length, lcMrr };
  });
  rows.sort((a, b) => Math.max(b.smMrr, b.lcMrr) - Math.max(a.smMrr, a.lcMrr));
  return table(
    ["", "Salesmate deals", "Salesmate MRR", "LimeCRM orgs", "LimeCRM MRR", "Δ MRR"],
    rows.map((r) => [r.k, r.smN, lakh(r.smMrr), r.lcN, lakh(r.lcMrr), delta(r.lcMrr - r.smMrr)]),
  );
}

export function reconciliationMarkdown(plan: Plan, active: ActiveOrgRow[], source: string) {
  const orgs = new Map(plan.orgs.map((o) => [o.id, o]));
  const smMrr = sum(plan.baseline.map((r) => r.value));
  const smOrgs = new Set(plan.baseline.map((r) => r.orgId).filter(Boolean));
  const lcMrr = sum(active.map((r) => r.mrr));
  const activeIds = new Set(active.map((r) => r.orgId));

  // Org-level diff: Salesmate active-deal MRR per org vs LimeCRM contracted MRR per active org.
  const perOrg = new Map<string, { sm: number; smDeals: number[]; lc: number }>();
  for (const r of plan.baseline) {
    const k = r.orgId ?? `deal:${r.dealId}`;
    const e = perOrg.get(k) ?? { sm: 0, smDeals: [], lc: 0 };
    e.sm += r.value;
    e.smDeals.push(r.dealId);
    perOrg.set(k, e);
  }
  for (const r of active) {
    const e = perOrg.get(r.orgId) ?? { sm: 0, smDeals: [], lc: 0 };
    e.lc += r.mrr;
    perOrg.set(r.orgId, e);
  }
  const diffs = [...perOrg.entries()].map(([id, e]) => ({ id, ...e, d: e.lc - e.sm, org: orgs.get(id) }));
  const notActive = diffs.filter((x) => x.sm > 0 && !activeIds.has(x.id));
  const notInSm = diffs.filter((x) => x.smDeals.length === 0 && x.lc > 0);
  const valueDiff = diffs.filter((x) => x.smDeals.length > 0 && activeIds.has(x.id) && Math.abs(x.d) >= 1);
  const byLifecycle = new Map<string, { n: number; mrr: number }>();
  for (const x of notActive) {
    const k = x.org?.lifecycle ?? "not migrated";
    const e = byLifecycle.get(k) ?? { n: 0, mrr: 0 };
    byLifecycle.set(k, { n: e.n + 1, mrr: e.mrr + x.sm });
  }

  const reviewFlags = plan.flags.filter((f) => f.severity === "review");
  const flagCounts = new Map<string, { review: number; info: number }>();
  for (const f of plan.flags) {
    const e = flagCounts.get(f.kind) ?? { review: 0, info: 0 };
    e[f.severity]++;
    flagCounts.set(f.kind, e);
  }
  const s = plan.stats;
  const top = [...diffs].filter((x) => Math.abs(x.d) >= 1).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 40);

  return `# Salesmate → LimeCRM reconciliation

_Source: ${source}. Snapshot \`${plan.snapshot}\`, transformed ${plan.generatedAt}._

LimeCRM side = organizations with lifecycle **active** and their contracted MRR (won deals not ended, src/server/mrr.ts).
Salesmate side = deals in the Customer Success pipeline at stage **Active Deals**, summing \`Value\`. Salesmate counts deals; LimeCRM counts organizations (clones collapsed, upsells rolled up).

## Headline

${table(
  ["", `Salesmate UI ${SALESMATE_REFERENCE.date}`, "Salesmate snapshot", "LimeCRM", "LimeCRM vs snapshot"],
  [
    ["Active customers", `${SALESMATE_REFERENCE.deals} deals`, `${plan.baseline.length} deals / ${smOrgs.size} orgs`, `${active.length} orgs`, `${active.length - smOrgs.size >= 0 ? "+" : ""}${active.length - smOrgs.size} orgs`],
    ["Contracted MRR", lakh(SALESMATE_REFERENCE.mrr), lakh(smMrr), lakh(lcMrr), `${delta(lcMrr - smMrr)} (${pct(lcMrr, smMrr)})`],
  ],
)}

Where the difference comes from:

${table(
  ["Bucket", "Orgs", "MRR effect"],
  [
    ["Salesmate Active Deal, but org not active in LimeCRM", notActive.length, delta(-sum(notActive.map((x) => x.sm)))],
    ...[...byLifecycle.entries()].map(([k, v]) => [`  ↳ LimeCRM lifecycle: ${k}`, v.n, delta(-v.mrr)]),
    ["Active in LimeCRM, no Salesmate Active Deal", notInSm.length, delta(sum(notInSm.map((x) => x.lc)))],
    ["In both, MRR differs (upsells in onboarding, CS-only values, ended deals)", valueDiff.length, delta(sum(valueDiff.map((x) => x.d)))],
  ],
)}

## By segment

${breakdown(plan, active, (r) => r.segment, (r) => r.segment)}

## By owner (CSM)

Salesmate: owner of the CS deal. LimeCRM: organization CSM.

${breakdown(plan, active, (r) => r.owner, (r) => r.csm)}

## Largest org-level differences

${table(
  ["Organization", "Lifecycle", "Salesmate deals", "Salesmate MRR", "LimeCRM MRR", "Δ"],
  top.map((x) => [x.org?.name ?? x.id, x.org?.lifecycle ?? "—", x.smDeals.join(" ") || "—", inr(x.sm), inr(x.lc), delta(x.d)]),
)}

## Migration summary

- Organizations: ${plan.orgs.length} (${["active", "onboarding", "on_hold", "churned", "prospect"].map((l) => `${l} ${s[`orgs.${l}`] ?? 0}`).join(" · ")})
- Deals: ${plan.deals.length} (won ${s["deals.won"] ?? 0} · open ${s["deals.open"] ?? 0} · lost ${s["deals.lost"] ?? 0}) from ${sum(["sales", "onboarding", "cs", "other"].map((p) => s[`salesmate.deals.${p}`] ?? 0))} Salesmate Sales/OB/CS/Default deals
- Clone groups: ${s["groups.total"] ?? 0} (high ${s["groups.high"] ?? 0} · medium ${s["groups.medium"] ?? 0} · low ${s["groups.low"] ?? 0}); ${s["groups.with_sales_ob_cs"] ?? 0} full Sales+OB+CS triples
- Onboardings ${plan.onboardings.length} · contacts ${plan.contacts.length} · activities ${plan.activities.length} (skipped ${s["activities.skipped_unlinked"] ?? 0} not linked to a migrated org) · users ${plan.users.length}
- Reconnect pipeline: ${s["reconnect.deals"] ?? 0} deals not migrated as deals (see reconnect.csv)
- Deals without a detail fetch: ${s["salesmate.deals.without_detail"] ?? 0}
- Unresolved custom fields: ${plan.unresolvedFields.length ? plan.unresolvedFields.join(", ") : "none"}

**${reviewFlags.length} items need review** (review.csv):

${table(
  ["Flag", "Review", "Info"],
  [...flagCounts.entries()].sort((a, b) => b[1].review - a[1].review || b[1].info - a[1].info).map(([k, v]) => [k, v.review, v.info]),
)}
`;
}
