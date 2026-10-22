/**
 * Salesmate snapshot → LimeCRM plan (Phase 3 transform, docs/PLAN.md §5.3).
 *
 *   pnpm migrate:transform [--snapshot data/salesmate/<ts>]
 *
 * Writes to <snapshot>/out/:
 *   plan.json           rows for `pnpm migrate:load`
 *   review.csv          everything a human should look at: low-confidence clone groups, org merges, outliers
 *   groups.csv          every collapsed sale (Sales + OB + CS deal ids) with its score
 *   custom-fields.csv   census of every Salesmate custom-field key (to pin unresolved fields in fields.ts)
 *   reconnect.csv       Reconnect-pipeline deals (not migrated as deals; see README)
 *   value-mapping.csv   every Salesmate dropdown value that isn't already LimeCRM-standard, and what it became
 *   report-preview.md   the reconciliation computed in memory, before any DB load
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dealTotals } from "@/domain/mrr";
import { addMonths, fromSalesmateStage } from "@/domain/reconnect";
import { istDay } from "@/domain/work";
import { collapseClones, type SaleGroup } from "./collapse";
import type { DealField } from "./fields";
import { day, list, num, str } from "./lib/raw";
import { parseArgs, resolveSnapshot, toCsv, writeJson, writeText } from "./lib/util";
import {
  activityTypeOf,
  billingCycleOf,
  churnCategoryOf,
  csState,
  dealTypeOf,
  healthOf,
  isCsActiveDeals,
  leadStageOf,
  leadStatusOf,
  obState,
  priorityOf,
  salesStageKey,
  segmentOf,
  type Segment,
} from "./mapping";
import { loadSnapshot, type SmDeal, type Snapshot } from "./normalize";
import type { BaselineRow, Flag, Plan, PlanActivity, PlanContact, PlanDeal, PlanLineItem, PlanOnboarding, PlanOrg, PlanReconnect, PlanUser } from "./plan";
import { reconciliationMarkdown } from "./report";
import { allowedValues, censusRows, standardizePlan } from "./standardize";

/** MRR above this (₹/month) is almost certainly a data-entry error (e.g. TCV typed into Value). */
export const MRR_OUTLIER = 500_000;
/** Won deals that never reached Onboarding/CS within this many days are treated as stale, not in flight. */
const STALE_WON_DAYS = 120;
const SALESMATE_BOT = 999_999;

type Life = "active" | "on_hold" | "onboarding" | "stale_won" | "churned" | "lost" | "open";
const ORG_RANK: Record<Life, number> = { active: 6, on_hold: 5, onboarding: 4, churned: 3, stale_won: 2, lost: 1, open: 1 };

type Sale = {
  g: SaleGroup;
  s?: SmDeal;
  o?: SmDeal;
  c?: SmDeal;
  members: SmDeal[];
  life: Life;
  /** Read a custom field from the first clone that has it, in the given order. */
  read: (name: DealField, order?: "commercial" | "onboarding" | "cs") => unknown;
  orgId?: string;
  deal?: PlanDeal;
};

const ORDERS = { commercial: ["s", "c", "o"], onboarding: ["o", "c", "s"], cs: ["c", "o", "s"] } as const;

const SLABS: [DealField, number | null][] = [
  ["slabT0a", 1000],
  ["slabT0b", 2000],
  ["slabT1", 5000],
  ["slabT2", 10000],
  ["slabT3", 15000],
  ["slabT4", 20000],
  ["slabT5", 25000],
  ["slabT6", null],
];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const latest = (ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

/** "(Pepe jeans) GOAT Brand Labs - Marketing - Upsell" → "goat brand labs". */
export function orgNameKey(name: string) {
  const k = name
    .replace(/^\s*\([^)]*\)\s*/, "")
    .split(/\s+[-–—|:]\s+/)[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return k.length >= 3 ? k : null;
}

const displayOrgName = (title: string) => title.replace(/^\s*\([^)]*\)\s*/, "").split(/\s+[-–—|:]\s+/)[0].trim() || title;

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export function buildPlan(snap: Snapshot): Plan {
  const now = new Date(String(snap.manifest.startedAt ?? new Date().toISOString()));
  const flags: Flag[] = [];
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
  const flag = (kind: string, severity: Flag["severity"], sale: Sale | null, detail: string, org: string | null = null) =>
    flags.push({ kind, severity, groupKey: sale?.g.key ?? null, org, salesmateDealIds: sale?.members.map((m) => m.id) ?? [], detail });

  for (const d of snap.deals) bump(`salesmate.deals.${d.pipeline}`);
  stats["salesmate.contacts"] = snap.contacts.size;
  stats["salesmate.companies"] = snap.companies.size;
  stats["salesmate.activities"] = snap.activities.length;
  stats["salesmate.deals.without_detail"] = snap.deals.filter((d) => !d.hasDetail).length;

  // ---------- users ----------
  const usedUsers = new Map<number, Record<string, number>>();
  const emailFor = (smUserId: number | null, pipeline = "other"): string | null => {
    if (!smUserId || smUserId === SALESMATE_BOT) return null;
    const u = snap.users.get(smUserId);
    const counts = usedUsers.get(smUserId) ?? {};
    counts[pipeline] = (counts[pipeline] ?? 0) + 1;
    usedUsers.set(smUserId, counts);
    return u?.email ?? `salesmate-user-${smUserId}@salesmate.invalid`;
  };

  // ---------- collapse clones into sales ----------
  const byId = new Map(snap.deals.map((d) => [d.id, d]));
  const inScope = snap.deals.filter((d) => d.pipeline !== "reconnect");
  const groups = collapseClones(inScope);
  const sales: Sale[] = groups.map((g) => {
    const s = g.sales ? byId.get(g.sales) : undefined;
    const o = g.ob ? byId.get(g.ob) : undefined;
    const c = g.cs ? byId.get(g.cs) : undefined;
    const slots = { s, o, c };
    return {
      g,
      s,
      o,
      c,
      members: [s, o, c].filter((x): x is SmDeal => !!x),
      life: "open",
      read: (name, order = "commercial") => {
        for (const k of ORDERS[order]) {
          const v = slots[k]?.f(name);
          if (str(v) !== null) return v;
        }
        return undefined;
      },
    };
  });
  for (const sale of sales) bump(`groups.${sale.g.confidence}`);
  stats["groups.total"] = sales.length;
  stats["groups.with_sales_ob_cs"] = sales.filter((x) => x.s && x.o && x.c).length;

  // ---------- per-sale lifecycle ----------
  for (const sale of sales) {
    const { s, o, c } = sale;
    if (c) {
      const st = csState(c.stage);
      if (st === "active") sale.life = "active";
      else if (st === "on_hold") sale.life = "on_hold";
      else if (st === "churned") sale.life = "churned";
      else {
        sale.life = "active";
        flag(st ? "cs_unclassified" : "unmapped_stage", "review", sale, `CS stage "${c.stage}" (deal ${c.id}) treated as active`);
      }
    } else if (o) {
      const st = obState(o.stage);
      if (!st) {
        sale.life = "onboarding";
        flag("unmapped_stage", "review", sale, `Onboarding stage "${o.stage}" (deal ${o.id}) treated as in onboarding`);
      } else if (st.kind === "churned") sale.life = "churned";
      else if (st.completed) {
        sale.life = "active";
        flag("handed_to_cs_without_cs_deal", "review", sale, `OB deal ${o.id} is "Handed to CS" but no CS deal matched; treated as active`);
      } else sale.life = st.key === "on_hold_billing" ? "on_hold" : "onboarding";
    } else if (s) {
      const key = salesStageKey(s.stage);
      if (!key) flag("unmapped_stage", "review", sale, `Sales stage "${s.stage}" (deal ${s.id}) mapped to qualified_meeting`);
      if (key === "won") {
        const closed = s.closedAt ?? date0(day(sale.read("handedToOnboardingDate"))) ?? s.modifiedAt;
        const ageDays = closed ? (now.getTime() - closed.getTime()) / 86_400_000 : Infinity;
        sale.life = ageDays <= STALE_WON_DAYS ? "onboarding" : "stale_won";
        if (sale.life === "stale_won")
          flag("won_without_handoff", "review", sale, `Sales deal ${s.id} is "${s.stage}" but has no Onboarding/CS deal; not counted as an active contract`);
        else flag("won_awaiting_onboarding", "info", sale, `Sales deal ${s.id} won recently with no Onboarding deal yet; onboarding record created`);
      } else sale.life = key === "lost" || key === "never_paid" ? "lost" : "open";
    }
    bump(`groups.life.${sale.life}`);
    if (sale.g.confidence === "low") flag("low_confidence_group", "review", sale, sale.g.reasons.join("; "));
    else if (!sale.s && (sale.life === "active" || sale.life === "onboarding" || sale.life === "on_hold"))
      flag("no_sales_deal", "info", sale, `${sale.g.reasons.join("; ")}; deal recreated from the ${sale.c ? "CS" : "OB"} clone`);
  }

  // ---------- organizations: union sales sharing a company, LC account id, or name ----------
  const uf = new UnionFind();
  const keysOf = (sale: Sale) => {
    const keys = new Set<string>();
    for (const m of sale.members) {
      if (m.companyId) keys.add(`co:${m.companyId}`);
      const contactCompany = m.contactId ? snap.contacts.get(m.contactId)?.companyId : null;
      if (contactCompany) keys.add(`co:${contactCompany}`);
      for (const lc of list(m.f("lcAccountId")).map(Number)) if (Number.isInteger(lc) && lc > 0) keys.add(`lc:${lc}`);
    }
    for (const k of [...keys].filter((k) => k.startsWith("co:"))) {
      const company = snap.companies.get(Number(k.slice(3)));
      const nk = company && orgNameKey(company.name);
      if (nk) keys.add(`nm:${nk}`);
      for (const lc of company?.lcAccountIds ?? []) keys.add(`lc:${lc}`);
    }
    if (![...keys].some((k) => k.startsWith("co:"))) {
      const nk = orgNameKey(sale.members[0].title);
      if (nk) keys.add(`nm:${nk}`);
    }
    if (!keys.size) keys.add(`g:${sale.g.key}`);
    return [...keys];
  };
  const saleKeys = new Map<Sale, string[]>();
  for (const sale of sales) {
    const keys = keysOf(sale);
    saleKeys.set(sale, keys);
    for (const k of keys.slice(1)) uf.union(keys[0], k);
  }
  const clusters = new Map<string, Sale[]>();
  for (const sale of sales) {
    const root = uf.find(saleKeys.get(sale)![0]);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(sale);
  }

  const orgs: PlanOrg[] = [];
  const orgByCompany = new Map<number, string>();
  for (const cluster of clusters.values()) {
    const id = randomUUID();
    const keys = [...new Set(cluster.flatMap((s) => saleKeys.get(s)!))];
    const companyIds = keys.filter((k) => k.startsWith("co:")).map((k) => Number(k.slice(3)));
    const lcIds = keys.filter((k) => k.startsWith("lc:")).map((k) => Number(k.slice(3)));
    // Most relevant sale first: best lifecycle, then most recent.
    const ranked = [...cluster].sort(
      (a, b) =>
        ORG_RANK[b.life] - ORG_RANK[a.life] ||
        (latest(b.members.map((m) => m.createdAt))?.getTime() ?? 0) - (latest(a.members.map((m) => m.createdAt))?.getTime() ?? 0),
    );
    const primary = ranked[0];
    const lifecycleLife = primary.life;
    const lifecycle: PlanOrg["lifecycle"] =
      lifecycleLife === "active" || lifecycleLife === "on_hold" || lifecycleLife === "onboarding" || lifecycleLife === "churned"
        ? lifecycleLife
        : lifecycleLife === "stale_won"
          ? "churned"
          : "prospect";

    const companies = companyIds.map((c) => snap.companies.get(c)).filter((c): c is NonNullable<typeof c> => !!c);
    const nameCounts = new Map<string, number>();
    for (const c of companies) nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
    const name = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? displayOrgName(primary.members[0].title);
    const firstOf = <T,>(fn: (s: Sale) => T | null | undefined) => {
      for (const s of ranked) {
        const v = fn(s);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    };

    let segment: Segment | null = null;
    const segs = new Set<Segment>();
    for (const s of ranked) {
      const r = segmentOf({
        natureOfAccount: str(s.read("natureOfAccount")),
        companyType: str(s.read("companyType")),
        dealLevel: str(s.read("dealLevel")),
        segment: str(s.read("segment")),
        accountClassifier: str(s.read("accountClassifier")),
      });
      if (r.segment) {
        segment ??= r.segment;
        segs.add(r.segment);
      }
      if (r.conflict) flag("segment_conflict", "info", s, "Nature Of The Account / Company Type / Deal Level / Segment disagree on enterprise vs not", name);
    }
    if (segs.has("enterprise") && segs.size > 1) flag("segment_conflict", "review", primary, `Sales in this org disagree on segment: ${[...segs].join(", ")}; using ${segment}`, name);

    const latestBy = (pick: (s: Sale) => SmDeal | undefined, filter: (s: Sale) => boolean = () => true) =>
      cluster
        .filter((s) => pick(s) && filter(s))
        .sort((a, b) => (pick(b)!.createdAt?.getTime() ?? 0) - (pick(a)!.createdAt?.getTime() ?? 0))[0];
    const aeSale = latestBy((s) => s.s, (s) => s.life !== "open" && s.life !== "lost") ?? latestBy((s) => s.s);
    const omSale = latestBy((s) => s.o);
    const csSale = latestBy((s) => s.c, (s) => s.life === "active" || s.life === "on_hold") ?? latestBy((s) => s.c);

    const churnSale = lifecycle === "churned" ? latestBy((s) => s.c ?? s.o, (s) => s.life === "churned") : undefined;
    const churnDay = (s: Sale) =>
      day(s.read("misChurnDate", "cs")) ??
      day(s.read("churnLastBillingDate", "cs")) ??
      day(s.read("churnCommunicationDate", "cs")) ??
      day((s.c ?? s.o)?.modifiedAt);

    const org: PlanOrg = {
      id,
      name,
      website: firstOf((s) => str(s.read("brandWebsite"))) ?? companies.find((c) => c.website)?.website ?? null,
      websiteTrafficRange: companies.find((c) => c.websiteTrafficRange)?.websiteTrafficRange ?? firstOf((s) => str(s.read("websiteTrafficRange"))),
      segment,
      industry: firstOf((s) => str(s.read("industry"))),
      hqCity: firstOf((s) => str(s.read("hqCity"))) ?? companies.find((c) => c.city)?.city ?? null,
      lifecycle,
      lcAccountIds: [...new Set(lcIds)].sort((a, b) => a - b),
      chargebeeCustomerId: companies.find((c) => c.chargebeeCustomerId)?.chargebeeCustomerId ?? null,
      health: csSale ? healthOf(str(csSale.read("csHealth", "cs"))) : null,
      healthNote: csSale ? str(csSale.read("healthRationale", "cs")) : null,
      churnedAt: churnSale ? churnDay(churnSale) : null,
      churnCategory: churnSale ? churnCategoryOf(str(churnSale.read("churnCategory", "cs"))) : null,
      churnReason: churnSale
        ? str(churnSale.read("churnReason", "cs"))
        : lifecycleLife === "stale_won"
          ? "Migrated from Salesmate: won deal never reached Onboarding or CS; status unknown"
          : null,
      churnLastBillingDate: churnSale ? day(churnSale.read("churnLastBillingDate", "cs")) : null,
      salesmateCompanyId: companyIds[0] ?? null,
      salesmateCompanyIds: companyIds,
      aeEmail: aeSale ? emailFor(aeSale.s!.ownerId, "sales") : null,
      omEmail: omSale ? emailFor(omSale.o!.ownerId, "onboarding") : null,
      csmEmail: csSale ? emailFor(csSale.c!.ownerId, "cs") : null,
      groupKeys: cluster.map((s) => s.g.key),
      createdAt: iso(cluster.flatMap((s) => s.members.map((m) => m.createdAt)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0]),
    };
    orgs.push(org);
    for (const c of companyIds) orgByCompany.set(c, id);
    for (const s of cluster) s.orgId = id;

    if (companyIds.length > 1) {
      const why = keys.filter((k) => !k.startsWith("co:")).join(", ");
      flag("org_merge", "review", primary, `${companyIds.length} Salesmate companies merged (${companies.map((c) => `${c.id} ${c.name}`).join(" | ")}) via ${why || "shared contacts"}`, name);
    }
    if (!companyIds.length) flag("org_from_title", "info", primary, `No Salesmate company on any deal; organization named "${name}" from the deal title`, name);
    bump(`orgs.${lifecycle}`);
  }

  // ---------- contacts ----------
  const contacts = new Map<number, PlanContact>();
  const addContact = (contactId: number | null, orgId: string | null) => {
    if (!contactId || contacts.has(contactId)) return;
    const c = snap.contacts.get(contactId);
    if (!c) return;
    const lead = leadStatusOf(c.leadStatus);
    if (c.leadStatus && !lead.status) bump(`contacts.unmapped_lead_status.${c.leadStatus}`);
    contacts.set(contactId, {
      id: randomUUID(),
      orgId: (c.companyId && orgByCompany.get(c.companyId)) || orgId,
      name: c.name,
      email: c.email,
      phone: c.phone,
      designation: c.designation,
      leadStatus: lead.status,
      leadStage: lead.stage ?? leadStageOf(c.leadStage),
      source: c.source,
      partnerName: c.partnerName,
      productInterest: c.productType,
      meetingScheduledAt: c.meetingScheduledAt,
      meetingCompletedAt: c.meetingCompletedAt,
      qualifiedAt: c.qualifiedAt,
      sqlAt: c.sqlAt,
      salesmateContactId: c.id,
      ownerEmail: emailFor(c.ownerId, "contact"),
    });
  };
  for (const sale of sales) for (const m of sale.members) addContact(m.contactId, sale.orgId!);
  for (const c of snap.contacts.values()) if (c.companyId && orgByCompany.has(c.companyId)) addContact(c.id, null);
  for (const [k, n] of Object.entries(stats).filter(([k]) => k.startsWith("contacts.unmapped_lead_status."))) {
    const status = k.slice("contacts.unmapped_lead_status.".length);
    flags.push({ kind: "unmapped_lead_status", severity: "review", groupKey: null, org: null, salesmateDealIds: [], detail: `Lead status "${status}" on ${n} contacts has no LimeCRM key; loaded as empty` });
  }

  // ---------- deals + line items ----------
  const deals: PlanDeal[] = [];
  for (const sale of sales) {
    const { s, o, c } = sale;
    const head = s ?? o ?? c!;
    const read = sale.read;

    let stageKey: string;
    if (s) {
      stageKey = salesStageKey(s.stage) ?? "qualified_meeting";
      if ((o || c) && stageKey !== "won") {
        flag("sales_stage_behind_clone", "info", sale, `Sales deal ${s.id} is at "${s.stage}" but has ${o ? "OB" : "CS"} clones; migrated as won`);
        stageKey = "won";
      }
    } else stageKey = "won";
    const status: PlanDeal["status"] = stageKey === "won" ? "won" : stageKey === "lost" || stageKey === "never_paid" ? "lost" : "open";

    // MRR: the CS clone's Value is the live book number (CSMs update it); then the Sales Value; then Monthly Invoice value.
    const currency = str(read("billingCurrency"))?.toUpperCase().includes("USD") ? "USD" : "INR";
    const invoice = num(read("monthlyInvoiceValue"));
    let mrrBase = 0;
    let mrrSource = "none";
    for (const [d, src] of [[c, "cs_value"], [s, "sales_value"], [o, "ob_value"]] as const) {
      if (d && d.value > 0) {
        mrrBase = d.value;
        mrrSource = src;
        break;
      }
    }
    if (!mrrBase && invoice && invoice > 0 && currency === "INR") {
      mrrBase = invoice;
      mrrSource = "monthly_invoice_value";
    }

    const items = lineItems(read, mrrBase, mrrSource);
    const totals = dealTotals(items);

    // ---- outliers ----
    const big = sale.members.filter((m) => m.value > MRR_OUTLIER);
    if (big.length || totals.mrr > MRR_OUTLIER) {
      flag("mrr_above_5L", "review", sale, `Value above ₹5L/mo: ${big.map((m) => `${m.pipeline} deal ${m.id} ₹${m.value}`).join(", ") || `computed MRR ₹${totals.mrr}`}`);
    }
    if (invoice && invoice > 0 && mrrBase > 0) {
      if (currency === "USD") flag("usd_billing", "info", sale, `Billed in USD (Monthly Invoice value ${invoice} USD); MRR kept in INR from deal Value ₹${mrrBase}`);
      else if (Math.abs(invoice - mrrBase) > Math.max(1000, 0.1 * mrrBase))
        flag("value_vs_invoice", "review", sale, `Deal Value ₹${mrrBase} (${mrrSource}) vs Monthly Invoice value ₹${invoice}`);
    }
    if (c && s && c.value > 0 && s.value > 0 && c.value !== s.value)
      flag("mrr_changed_after_handoff", "info", sale, `Sales Value ₹${s.value} → CS Value ₹${c.value}; using CS`);
    if ((sale.life === "active" || sale.life === "on_hold") && totals.mrr === 0) flag("active_zero_mrr", "review", sale, "Active in CS but no Value or Monthly Invoice value");
    if (head.status.toLowerCase() === "won" && status === "lost") flag("status_stage_conflict", "info", sale, `Salesmate status Won but stage "${head.stage}"`);

    const closedAt =
      status === "open"
        ? null
        : (s?.closedAt ?? date0(day(read("handedToOnboardingDate"))) ?? o?.createdAt ?? c?.createdAt ?? head.modifiedAt);
    const churnDay =
      day(read("misChurnDate", "cs")) ?? day(read("churnLastBillingDate", "cs")) ?? day(read("churnCommunicationDate", "cs")) ?? day((c ?? o)?.modifiedAt);
    const endedAt =
      status !== "won" ? null : sale.life === "churned" ? churnDay : sale.life === "stale_won" ? (day(closedAt) ?? day(now)) : null;

    const products = list(read("productType"));
    const deal: PlanDeal = {
      id: randomUUID(),
      orgId: sale.orgId!,
      primaryContactId: contacts.get(head.contactId ?? -1)?.id ?? contacts.get((o ?? c)?.contactId ?? -1)?.id ?? null,
      title: head.title,
      type: dealTypeOf(head.title, str(read("dealType")), str(read("businessType"))),
      stageKey,
      status,
      ownerEmail: emailFor(head.ownerId, head.pipeline),
      source: str(read("contactSource")) ?? head.source,
      partnerName: str(read("partnerName")),
      plan: str(read("plan")),
      products: products.length ? products : list(read("productsInScope")),
      priority: priorityOf(s?.priority ?? null),
      expectedCloseDate: day(s?.estimatedClose),
      closedAt: iso(closedAt),
      endedAt,
      lostReason: status === "lost" ? (str(read("whyClosedLost")) ?? s?.lostReason ?? (stageKey === "never_paid" ? "Signed, never paid (Sales Churn)" : "Unknown (migrated)")) : null,
      lostDetail: status === "lost" && str(read("whyClosedLost")) && s?.lostReason ? s.lostReason : null,
      billingCycle: billingCycleOf(str(read("billingCycle"))),
      currency: "INR",
      contractStart: day(read("contractStart")),
      contractRenewal: day(read("contractRenew")),
      contractLink: str(read("contractLink")),
      requiresOnboarding: true,
      mrr: totals.mrr,
      oneTimeFee: totals.oneTimeFee,
      salesmateDealIds: sale.members.map((m) => m.id),
      createdAt: iso(head.createdAt),
      modifiedAt: iso(
        sale.members
          .map((m) => m.modifiedAt)
          .filter((d): d is Date => !!d)
          .sort((a, b) => b.getTime() - a.getTime())[0],
      ),
      lineItems: items,
      groupKey: sale.g.key,
      confidence: sale.g.confidence,
      mrrSource,
    };
    sale.deal = deal;
    deals.push(deal);
    bump(`deals.${status}`);
  }

  // ---------- onboardings ----------
  const onboardings: PlanOnboarding[] = [];
  for (const sale of sales) {
    const { o, c } = sale;
    if (!o && sale.life !== "onboarding") continue;
    if (!o && sale.s && sale.deal?.status !== "won") continue;
    const read = sale.read;
    let stageKey = "not_started";
    let completedAt: Date | null = null;
    const notes: string[] = [];
    if (o) {
      const st = obState(o.stage);
      if (st?.kind === "churned") {
        stageKey = "on_hold_billing";
        completedAt = date0(day(read("churnLastBillingDate", "onboarding"))) ?? o.modifiedAt ?? now;
        notes.push("Churned during onboarding (Salesmate OB stage: Churned).");
      } else if (st) {
        stageKey = st.key;
        if (st.completed) completedAt = c?.createdAt ?? o.modifiedAt ?? now;
      }
      if (!completedAt && c) {
        // A CS clone exists, so the handoff happened even if the OB stage wasn't moved.
        completedAt = c.createdAt ?? now;
        notes.push(`Salesmate OB stage was "${o.stage}" but a CS deal exists; marked complete.`);
      }
    } else notes.push("Created by migration: won in Salesmate with no Onboarding deal yet.");
    const kickoff = day(read("kickoffDate", "onboarding"));
    onboardings.push({
      id: randomUUID(),
      orgId: sale.orgId!,
      dealId: sale.deal!.id,
      stageKey,
      omEmail: o ? emailFor(o.ownerId, "onboarding") : null,
      kickoffDate: kickoff,
      goLiveDate: day(read("botGoLiveDate", "onboarding")),
      health: healthOf(str(read("onbHealth", "onboarding"))),
      nps: num(read("nps", "onboarding")) !== null ? Math.round(num(read("nps", "onboarding"))!) : null,
      voiceAdoption: str(read("voiceAdoption", "onboarding")),
      notes: notes.join(" ") || null,
      completedAt: iso(completedAt),
      createdAt: iso(o?.createdAt ?? (sale.deal?.closedAt ? new Date(sale.deal.closedAt) : null)),
      salesmateDealId: o?.id ?? null,
    });
  }
  // LimeCRM allows one open onboarding per organization: keep the newest open, close the rest.
  const openByOrg = new Map<string, PlanOnboarding[]>();
  for (const ob of onboardings) if (!ob.completedAt) openByOrg.set(ob.orgId, [...(openByOrg.get(ob.orgId) ?? []), ob]);
  for (const [orgId, open] of openByOrg) {
    if (open.length < 2) continue;
    open.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    for (const older of open.slice(1)) {
      older.completedAt = open[0].createdAt ?? now.toISOString();
      older.notes = [older.notes, "Closed by migration: overlapped a newer onboarding for the same organization."].filter(Boolean).join(" ");
    }
    const org = orgs.find((x) => x.id === orgId)!;
    flags.push({
      kind: "overlapping_onboardings",
      severity: "review",
      groupKey: null,
      org: org.name,
      salesmateDealIds: open.map((x) => x.salesmateDealId).filter((x): x is number => !!x),
      detail: `${open.length} onboardings in flight; kept the newest open`,
    });
  }

  // ---------- activities ----------
  const dealBySmId = new Map<number, PlanDeal>();
  for (const d of deals) for (const id of d.salesmateDealIds) dealBySmId.set(id, d);
  const activities: PlanActivity[] = [];
  for (const a of snap.activities) {
    const deal = a.dealId ? dealBySmId.get(a.dealId) : undefined;
    const contact = a.contactId ? contacts.get(a.contactId) : undefined;
    const orgId = deal?.orgId ?? contact?.orgId ?? (a.companyId ? orgByCompany.get(a.companyId) : undefined);
    if (!orgId) {
      bump("activities.skipped_unlinked");
      continue;
    }
    activities.push({
      id: randomUUID(),
      type: activityTypeOf(a.type),
      subject: a.title,
      body: a.description,
      orgId,
      dealId: deal?.id ?? null,
      contactId: contact?.id ?? null,
      ownerEmail: emailFor(a.ownerId, "activity"),
      dueAt: iso(a.dueAt),
      completedAt: iso(a.completedAt ?? (a.isCompleted ? (a.dueAt ?? a.createdAt) : null)),
      createdAt: iso(a.createdAt),
      salesmateActivityId: a.id,
    });
  }

  // ---------- reconnect (nurture list, not deals) ----------
  // Due N months after the deal was last touched in Salesmate (so long-ignored ones come due now),
  // or after the snapshot when Salesmate didn't say. Unknown stages are flagged, not guessed.
  const reconnects: PlanReconnect[] = [];
  for (const d of snap.deals.filter((x) => x.pipeline === "reconnect")) {
    const rule = fromSalesmateStage(d.stage);
    const companyName = (d.companyName ?? d.title).trim();
    if (!rule || !companyName) {
      flags.push({ kind: "reconnect_skipped", severity: "info", groupKey: null, org: companyName || null, salesmateDealIds: [d.id], detail: `Reconnect deal at stage "${d.stage}" not imported` });
      continue;
    }
    reconnects.push({
      salesmateDealId: d.id,
      companyName,
      salesmateCompanyId: d.companyId,
      aeEmail: emailFor(d.ownerId, "sales"),
      reconnectOn: addMonths(istDay(d.modifiedAt ?? d.createdAt ?? now), rule.months),
      reason: d.title !== companyName ? `${rule.reason} · ${d.title}` : rule.reason,
    });
  }

  // ---------- users ----------
  const users: PlanUser[] = [];
  const seen = new Set<string>();
  for (const [smId, counts] of usedUsers) {
    const u = snap.users.get(smId);
    const email = u?.email ?? `salesmate-user-${smId}@salesmate.invalid`;
    if (seen.has(email)) continue;
    seen.add(email);
    const top = Object.entries(counts)
      .filter(([k]) => ["sales", "onboarding", "cs"].includes(k))
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    users.push({
      email,
      name: u?.name ?? `Salesmate user ${smId}`,
      role: top === "sales" ? "sales" : top === "onboarding" ? "onboarding" : top === "cs" ? "cs" : "viewer",
      isActive: u?.active ?? true,
      salesmateUserId: smId,
    });
    if (!u?.email) flags.push({ kind: "user_without_email", severity: "review", groupKey: null, org: null, salesmateDealIds: [], detail: `Salesmate user ${smId} (${u?.name ?? "unknown"}) has no email; created as ${email}` });
  }

  // ---------- baseline: Salesmate's CS "Active Deals" ----------
  const saleOf = new Map<number, Sale>();
  for (const sale of sales) for (const m of sale.members) saleOf.set(m.id, sale);
  const baseline: BaselineRow[] = snap.deals
    .filter((d) => isCsActiveDeals(d.pipeline, d.stage))
    .map((d) => {
      const seg = segmentOf({
        natureOfAccount: str(d.f("natureOfAccount")),
        companyType: str(d.f("companyType")),
        dealLevel: str(d.f("dealLevel")),
        segment: str(d.f("segment")),
        accountClassifier: str(d.f("accountClassifier")),
      }).segment;
      return {
        dealId: d.id,
        title: d.title,
        value: d.value,
        segment: seg ?? "(none)",
        owner: snap.users.get(d.ownerId ?? 0)?.name ?? "(none)",
        orgId: saleOf.get(d.id)?.orgId ?? null,
      };
    });

  for (const f of flags) bump(`flags.${f.kind}`);
  stats["reconnect.deals"] = snap.deals.filter((d) => d.pipeline === "reconnect").length;

  return {
    snapshot: snap.dir,
    generatedAt: new Date().toISOString(),
    users,
    orgs,
    contacts: [...contacts.values()],
    deals,
    onboardings,
    activities,
    reconnects,
    baseline,
    flags,
    stats,
    unresolvedFields: snap.fields.deal.unresolved.map((f) => `deal.${f}`).concat(snap.fields.company.unresolved.map((f) => `company.${f}`)),
  };
}

const date0 = (d: string | null) => (d ? new Date(`${d}T00:00:00+05:30`) : null);

/** Salesmate's flat rate card → deal line items. Usage rates get quantity 0 (no committed MRR); the Value becomes the platform fee. */
function lineItems(read: Sale["read"], mrr: number, mrrSource: string): PlanLineItem[] {
  const items: PlanLineItem[] = [];
  const add = (item: Omit<PlanLineItem, "position" | "quantity" | "includedFree" | "billingCycle" | "tiers" | "description"> & Partial<PlanLineItem>) =>
    items.push({ description: null, quantity: 0, includedFree: 0, billingCycle: "monthly", tiers: null, ...item, position: items.length });
  const rate = (name: DealField) => {
    const n = num(read(name));
    return n !== null && n > 0 ? n : null;
  };

  if (mrr > 0) add({ kind: "platform_fee", unitPrice: mrr, quantity: 1, description: `Monthly MRR migrated from Salesmate (${mrrSource.replace(/_/g, " ")})` });

  const agent = rate("perAgentFee");
  if (agent !== null) add({ kind: "agent_seat", unitPrice: agent, includedFree: num(read("freeAgents")) ?? 0 });

  const tiers = SLABS.map(([f, upTo]) => ({ upTo, unitPrice: rate(f) })).filter((t): t is { upTo: number | null; unitPrice: number } => t.unitPrice !== null);
  const session = rate("costPerBotSession") ?? rate("costPerSession") ?? tiers[0]?.unitPrice ?? null;
  if (session !== null)
    add({ kind: "bot_session", unitPrice: session, includedFree: num(read("freeBotSessions")) ?? 0, tiers: tiers.length ? tiers : null, description: str(read("botSlabPricing")) });

  for (const [kind, field] of [
    ["wa_marketing", "waMarketing"],
    ["wa_utility", "waUtility"],
    ["sms", "costPerSms"],
    ["email", "costPerEmail"],
    ["image_ai", "imageAiCost"],
    ["inbound_calling", "inboundCalling"],
  ] as const) {
    const r = rate(field);
    if (r !== null) add({ kind, unitPrice: r });
  }
  const minute = rate("costPerMinute");
  if (minute !== null) add({ kind: "voice_minute", unitPrice: minute, includedFree: num(read("freeVoiceMinutes")) ?? 0 });
  const outbound = rate("outboundCalling") ?? rate("outboundCost");
  if (outbound !== null) add({ kind: "outbound_calling", unitPrice: outbound });

  const impl = num(read("implementationFees"));
  if (impl !== null && impl >= 0) add({ kind: "implementation_fee", unitPrice: impl, quantity: 1, billingCycle: "one_time" });
  return items;
}

function customFieldCensus(snap: Snapshot) {
  const resolvedBy = new Map(Object.entries(snap.fields.deal.keys).map(([name, key]) => [key, name]));
  const census = new Map<string, { filled: number; samples: Set<string> }>();
  for (const raw of snap.rawDeals) {
    for (const [k, v] of Object.entries(raw)) {
      if (!/CustomField\d+$/.test(k)) continue;
      const e = census.get(k) ?? { filled: 0, samples: new Set<string>() };
      const s = str(v);
      if (s !== null) {
        e.filled++;
        if (e.samples.size < 5) e.samples.add(s.slice(0, 60));
      }
      census.set(k, e);
    }
  }
  return [...census.entries()]
    .sort((a, b) => b[1].filled - a[1].filled)
    .map(([key, e]) => ({ key, mapped_to: resolvedBy.get(key) ?? "", filled: e.filled, samples: [...e.samples].join(" | ") }));
}

function main() {
  const args = parseArgs();
  const dir = resolveSnapshot(args.snapshot);
  console.log(`snapshot: ${dir}`);
  const snap = loadSnapshot(dir);
  const plan = buildPlan(snap);
  const out = join(dir, "out");
  // Field standards (src/domain/fields.ts) before anything is written: the load inserts as-is.
  const census = standardizePlan(plan, allowedValues());

  writeJson(join(out, "plan.json"), plan);
  const mapping = censusRows(census);
  writeText(join(out, "value-mapping.csv"), toCsv(mapping));
  const cleared = mapping.filter((r) => r.limecrm_value.startsWith("(cleared"));
  console.log(`values: ${mapping.length - cleared.length} mapped to standard, ${cleared.length} not on any list (cleared) → ${join(out, "value-mapping.csv")}`);

  const groupRows = plan.deals.map((d) => ({
    group: d.groupKey,
    confidence: d.confidence,
    organization: plan.orgs.find((o) => o.id === d.orgId)?.name,
    title: d.title,
    salesmate_deal_ids: d.salesmateDealIds,
    stage: d.stageKey,
    mrr: d.mrr,
    mrr_source: d.mrrSource,
  }));
  writeText(join(out, "groups.csv"), toCsv(groupRows));

  const sev = { review: 0, info: 1 };
  const review = [...plan.flags]
    .sort((a, b) => sev[a.severity] - sev[b.severity] || a.kind.localeCompare(b.kind))
    .map((f) => ({
      severity: f.severity,
      kind: f.kind,
      organization: f.org ?? plan.orgs.find((o) => o.groupKeys.includes(f.groupKey ?? ""))?.name ?? "",
      group: f.groupKey ?? "",
      salesmate_deal_ids: f.salesmateDealIds,
      salesmate_links: f.salesmateDealIds.map((id) => `https://limechat.salesmate.io/#/app/deals/${id}/detail`),
      detail: f.detail,
    }));
  writeText(join(out, "review.csv"), toCsv(review, ["severity", "kind", "organization", "group", "salesmate_deal_ids", "salesmate_links", "detail"]));
  writeText(join(out, "custom-fields.csv"), toCsv(customFieldCensus(snap)));
  writeText(
    join(out, "reconnect.csv"),
    toCsv(
      snap.deals
        .filter((d) => d.pipeline === "reconnect")
        .map((d) => ({ id: d.id, title: d.title, stage: d.stage, value: d.value, owner: snap.users.get(d.ownerId ?? 0)?.name, contact: d.contactName, company: d.companyName })),
    ),
  );

  const preview = reconciliationMarkdown(plan, previewActive(plan), "in-memory preview (not loaded)");
  writeText(join(out, "report-preview.md"), preview);

  const reviewCount = plan.flags.filter((f) => f.severity === "review").length;
  console.log(
    `orgs ${plan.orgs.length} · deals ${plan.deals.length} · onboardings ${plan.onboardings.length} · contacts ${plan.contacts.length} · activities ${plan.activities.length} · users ${plan.users.length}`,
  );
  console.log(`groups: ${plan.stats["groups.high"] ?? 0} high · ${plan.stats["groups.medium"] ?? 0} medium · ${plan.stats["groups.low"] ?? 0} low`);
  console.log(`${reviewCount} items to review → ${join(out, "review.csv")}`);
  if (plan.unresolvedFields.length) console.log(`unresolved custom fields (see custom-fields.csv): ${plan.unresolvedFields.join(", ")}`);
  console.log(`preview → ${join(out, "report-preview.md")}`);
}

/** Active orgs and their contracted MRR computed in memory, mirroring src/server/mrr.ts#recomputeOrg. */
export function previewActive(plan: Plan) {
  const users = new Map(plan.users.map((u) => [u.email, u.name]));
  return plan.orgs
    .filter((o) => o.lifecycle === "active")
    .map((o) => ({
      orgId: o.id,
      name: o.name,
      segment: o.segment ?? "(none)",
      csm: (o.csmEmail && users.get(o.csmEmail)) || "(none)",
      mrr: plan.deals.filter((d) => d.orgId === o.id && d.status === "won" && !d.endedAt).reduce((s, d) => s + d.mrr, 0),
    }));
}

if (process.argv[1]?.endsWith("transform.ts")) main();
