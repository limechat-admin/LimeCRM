/**
 * Bring a transform plan onto LimeCRM's field standards (src/domain/fields.ts) before it's loaded:
 * picklist values to their standard spelling, websites to domains, emails lower case, phones E.164,
 * names tidied. Values that don't match any option are cleared and counted in a census, so Sales
 * Ops can add them as options or aliases and re-run; nothing non-standard reaches the database.
 */
import { matchOption, normalizeEmail, normalizePhone, normalizeWebsite, PICKLIST, tidyName, type PicklistKey } from "@/domain/fields";
import type { Plan } from "./plan";

export type Census = Map<string, { field: PicklistKey; raw: string; count: number; mappedTo: string | null }>;

/** Every value a picklist accepts: the seeds (active and retired) plus any extras from the database. */
export function allowedValues(extra: Partial<Record<PicklistKey, string[]>> = {}): Record<PicklistKey, string[]> {
  return Object.fromEntries(
    Object.values(PICKLIST).map((p) => [p.key, [...new Set([...p.seeds, ...(p.retiredSeeds ?? []), ...(extra[p.key] ?? [])])]]),
  ) as Record<PicklistKey, string[]>;
}

export function standardizePlan(plan: Plan, allowed: Record<PicklistKey, string[]>) {
  const census: Census = new Map();
  const note = (field: PicklistKey, raw: string, mappedTo: string | null) => {
    const k = `${field}\u0000${raw}`;
    const row = census.get(k) ?? { field, raw, count: 0, mappedTo };
    row.count++;
    census.set(k, row);
  };
  const one = (field: PicklistKey, raw: string | null, fallback: string | null = null): string | null => {
    if (!raw?.trim()) return raw === null ? null : fallback;
    const m = matchOption(raw, allowed[field], PICKLIST[field].aliases);
    if (m !== raw) note(field, raw, m);
    return m ?? fallback;
  };
  // Salesmate multi-selects sometimes hold several values in one option ("Click based bot; Broadcasts; Flows").
  const many = (field: PicklistKey, raw: string[]): string[] => [
    ...new Set(
      raw
        .flatMap((r) => r.split(";"))
        .map((r) => one(field, r.trim()))
        .filter((v): v is string => !!v),
    ),
  ];

  for (const o of plan.orgs) {
    o.name = tidyName(o.name);
    o.website = o.website ? (normalizeWebsite(o.website) ?? o.website.trim()) : null;
    o.industry = one("industry", o.industry);
    o.websiteTrafficRange = one("traffic_band", o.websiteTrafficRange);
  }
  for (const c of plan.contacts) {
    c.name = tidyName(c.name);
    c.email = c.email ? (normalizeEmail(c.email) ?? c.email.trim()) : null;
    c.phone = normalizePhone(c.phone);
    c.source = one("source", c.source);
    c.partnerName = one("partner", c.partnerName);
    c.productInterest = many("products", c.productInterest);
  }
  for (const d of plan.deals) {
    d.source = one("source", d.source);
    d.partnerName = one("partner", d.partnerName);
    d.plan = one("plan", d.plan);
    d.products = many("products", d.products);
    // A lost deal must keep a reason (the Closed Lost gate), so an unmatched one becomes the retired "Unknown (migrated)".
    if (d.lostReason !== null) d.lostReason = one("lost_reason", d.lostReason, "Unknown (migrated)");
  }
  return census;
}

/** Census rows for out/value-mapping.csv, biggest first; unmatched values first of all. */
export function censusRows(census: Census) {
  return [...census.values()]
    .sort((a, b) => Number(!!a.mappedTo) - Number(!!b.mappedTo) || b.count - a.count)
    .map((r) => ({ field: PICKLIST[r.field].label, salesmate_value: r.raw, records: r.count, limecrm_value: r.mappedTo ?? "(cleared: not on the list)" }));
}
