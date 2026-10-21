/**
 * Undo Salesmate's clone-per-pipeline: each sale exists as up to three deals (Sales → Onboarding → CS)
 * with the same title / contact / company. Group them back into one "sale".
 *
 * Pass 1 matches Onboarding clones to Sales deals; pass 2 matches CS clones to the resulting groups
 * (so a CS clone can attach through its Onboarding sibling when the Sales deal is missing).
 * Assignment is greedy by score, one clone per pipeline per sale. Clones nobody claims start their own group.
 */
import type { Pipeline } from "./normalize";

export type CloneInput = {
  id: number;
  title: string;
  pipeline: Pipeline;
  contactId: number | null;
  companyId: number | null;
  createdAt: Date | null;
  value: number;
};

export type Confidence = "high" | "medium" | "low";

export type SaleGroup = {
  key: string;
  sales: number | null;
  ob: number | null;
  cs: number | null;
  /** Weakest link score (null for a single-deal group). */
  score: number | null;
  confidence: Confidence;
  reasons: string[];
};

const MIN_SCORE = 40;
const HIGH = 80;
const MEDIUM = 55;
const AMBIGUITY_GAP = 10;
const DAY = 86_400_000;

const STOP = new Set(["ob", "cs", "onboarding", "clone", "copy", "customer", "success"]);

export const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ");

function jaccard(a: string, b: string) {
  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

export function scorePair(anchor: CloneInput, clone: CloneInput) {
  const reasons: string[] = [];
  let score = 0;
  const ta = normTitle(anchor.title);
  const tc = normTitle(clone.title);
  if (ta && ta === tc) {
    score += 50;
    reasons.push("title");
  } else {
    const j = jaccard(ta, tc);
    if (j >= 0.8) {
      score += 35;
      reasons.push(`title~${j.toFixed(2)}`);
    } else if (j >= 0.6) {
      score += 20;
      reasons.push(`title~${j.toFixed(2)}`);
    }
  }
  if (anchor.contactId && clone.contactId) {
    if (anchor.contactId === clone.contactId) {
      score += 25;
      reasons.push("contact");
    } else {
      score -= 20;
      reasons.push("contact≠");
    }
  }
  if (anchor.companyId && clone.companyId) {
    if (anchor.companyId === clone.companyId) {
      score += 20;
      reasons.push("company");
    } else {
      score -= 20;
      reasons.push("company≠");
    }
  }
  if (anchor.createdAt && clone.createdAt) {
    if (clone.createdAt.getTime() >= anchor.createdAt.getTime() - 2 * DAY) score += 5;
    else {
      score -= 10;
      reasons.push("clone older than anchor");
    }
  }
  if (anchor.value > 0 && anchor.value === clone.value) {
    score += 5;
    reasons.push("value");
  }
  return { score, reasons };
}

const confidenceOf = (score: number): Confidence => (score >= HIGH ? "high" : score >= MEDIUM ? "medium" : "low");

type Slot = "ob" | "cs";

export function collapseClones(deals: CloneInput[]): SaleGroup[] {
  const byId = new Map(deals.map((d) => [d.id, d]));
  const groups: SaleGroup[] = deals
    .filter((d) => d.pipeline === "sales" || d.pipeline === "other")
    .map((d) => ({ key: `s${d.id}`, sales: d.id, ob: null, cs: null, score: null, confidence: "high", reasons: [] }));

  const members = (g: SaleGroup) => [g.sales, g.ob, g.cs].filter((x): x is number => x !== null).map((id) => byId.get(id)!);

  const attach = (pipeline: Pipeline, slot: Slot) => {
    // Candidate lookup by exact title, contact and company.
    const idx = new Map<string, Set<SaleGroup>>();
    const add = (k: string, g: SaleGroup) => {
      if (!idx.has(k)) idx.set(k, new Set());
      idx.get(k)!.add(g);
    };
    for (const g of groups) {
      for (const m of members(g)) {
        add(`t:${normTitle(m.title)}`, g);
        if (m.contactId) add(`p:${m.contactId}`, g);
        if (m.companyId) add(`c:${m.companyId}`, g);
      }
    }

    const clones = deals.filter((d) => d.pipeline === pipeline);
    type Cand = { clone: CloneInput; group: SaleGroup; score: number; reasons: string[]; gap: number };
    const cands: Cand[] = [];
    const scoredByClone = new Map<number, Cand[]>();
    for (const c of clones) {
      const pool = new Set<SaleGroup>([
        ...(idx.get(`t:${normTitle(c.title)}`) ?? []),
        ...(c.contactId ? idx.get(`p:${c.contactId}`) ?? [] : []),
        ...(c.companyId ? idx.get(`c:${c.companyId}`) ?? [] : []),
      ]);
      const scored = [...pool]
        .map((g) => {
          // Score against the group's best-matching member (Sales deal or its OB clone).
          const best = members(g)
            .map((m) => ({ ...scorePair(m, c), m }))
            .sort((a, b) => b.score - a.score)[0];
          const gap = best.m.createdAt && c.createdAt ? Math.abs(c.createdAt.getTime() - best.m.createdAt.getTime()) : Infinity;
          return { clone: c, group: g, score: best.score, reasons: best.reasons, gap };
        })
        .filter((x) => x.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score || a.gap - b.gap);
      cands.push(...scored);
      scoredByClone.set(c.id, scored);
    }

    cands.sort((a, b) => b.score - a.score || a.gap - b.gap);
    const assigned = new Set<number>();
    const lostTo = new Map<number, number>();
    for (const x of cands) {
      if (assigned.has(x.clone.id)) continue;
      if (x.group[slot] !== null) {
        if (!lostTo.has(x.clone.id)) lostTo.set(x.clone.id, x.group[slot]!);
        continue;
      }
      x.group[slot] = x.clone.id;
      assigned.add(x.clone.id);
      const reasons = [`${slot}:${x.reasons.join("+")}`];
      let conf = confidenceOf(x.score);
      const rival = scoredByClone.get(x.clone.id)!.find((y) => y.group !== x.group && y.score >= x.score - AMBIGUITY_GAP);
      if (rival) {
        // Two sales fit this clone equally well: usually a duplicate Sales deal. Both go to review.
        conf = "low";
        reasons.push(`${slot} deal ${x.clone.id} ambiguous: also fits ${rival.group.key} (${rival.score} vs ${x.score})`);
        rival.group.confidence = "low";
        rival.group.reasons.push(`possible duplicate of ${x.group.key}: ${slot} deal ${x.clone.id} fits both (${rival.score} vs ${x.score})`);
      }
      if (lostTo.has(x.clone.id)) reasons.push(`${slot} best match was already taken by deal ${lostTo.get(x.clone.id)}`);
      x.group.score = x.group.score === null ? x.score : Math.min(x.group.score, x.score);
      x.group.reasons.push(...reasons);
      if (rank(conf) < rank(x.group.confidence)) x.group.confidence = conf;
    }

    for (const c of clones) {
      if (assigned.has(c.id)) continue;
      const g: SaleGroup = { key: `${slot}${c.id}`, sales: null, ob: null, cs: null, score: null, confidence: "medium", reasons: [] };
      g[slot] = c.id;
      if (lostTo.has(c.id)) {
        g.confidence = "low";
        g.reasons.push(`possible duplicate ${slot} clone: its sale already has ${slot} deal ${lostTo.get(c.id)}`);
      } else g.reasons.push(`no matching ${slot === "cs" ? "Sales/Onboarding" : "Sales"} deal`);
      groups.push(g);
    }
  };

  attach("onboarding", "ob");
  attach("cs", "cs");
  return groups;
}

const rank = (c: Confidence) => (c === "high" ? 2 : c === "medium" ? 1 : 0);
