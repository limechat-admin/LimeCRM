import type { Stage } from "@/db/schema";
import type { GateFieldKey } from "./gates";

type StageDef = Omit<Stage, "id" | "requiredFields"> & { requiredFields: GateFieldKey[] };

/**
 * Canonical stages. Salesmate's Onboarding and CS pipelines are no longer deal pipelines:
 * a won deal opens an Onboarding record, and CS is the organization's lifecycle.
 * Gates mirror Salesmate's conditional-required rules (docs/salesmate-inventory.md §3).
 */
export const SALES_STAGES: StageDef[] = [
  {
    pipeline: "sales",
    key: "qualified_meeting",
    name: "Qualified Meeting",
    position: 1,
    kind: "open",
    winProbability: 10,
    requiredFields: ["deal.owner", "deal.type", "deal.plan", "deal.products", "org.website"],
  },
  {
    pipeline: "sales",
    key: "sql",
    name: "Sales Qualified Lead",
    position: 2,
    kind: "open",
    winProbability: 20,
    requiredFields: ["deal.expected_close_date", "deal.priority"],
  },
  { pipeline: "sales", key: "ongoing_discussion", name: "Ongoing Discussion", position: 3, kind: "open", winProbability: 40, requiredFields: [] },
  { pipeline: "sales", key: "commercial_discussion", name: "Commercial Discussion", position: 4, kind: "open", winProbability: 70, requiredFields: [] },
  {
    pipeline: "sales",
    key: "agreement_sent",
    name: "Agreement Sent",
    position: 5,
    kind: "open",
    winProbability: 80,
    requiredFields: ["deal.pricing", "deal.implementation_fee"],
  },
  {
    pipeline: "sales",
    key: "agreement_signed",
    name: "Agreement Signed",
    position: 6,
    kind: "open",
    winProbability: 90,
    requiredFields: ["deal.billing_cycle", "deal.contract_start", "deal.contract_renewal"],
  },
  {
    pipeline: "sales",
    key: "invoice_raised",
    name: "Invoice Raised",
    position: 7,
    kind: "open",
    winProbability: 95,
    requiredFields: ["org.lc_account_id", "deal.contract_link", "org.segment"],
  },
  { pipeline: "sales", key: "won", name: "Won · Handed over", position: 8, kind: "won", winProbability: 100, requiredFields: [] },
  { pipeline: "sales", key: "lost", name: "Closed Lost", position: 9, kind: "lost", winProbability: 0, requiredFields: ["deal.lost_reason"] },
  { pipeline: "sales", key: "never_paid", name: "Signed, Never Paid", position: 10, kind: "lost", winProbability: 0, requiredFields: ["deal.lost_reason"] },
];

export const ONBOARDING_STAGES: StageDef[] = [
  { pipeline: "onboarding", key: "not_started", name: "Not Started", position: 1, kind: "open", winProbability: null, requiredFields: [] },
  { pipeline: "onboarding", key: "kickoff_pending", name: "Kick-off Pending", position: 2, kind: "open", winProbability: null, requiredFields: ["onboarding.om"] },
  { pipeline: "onboarding", key: "implementation", name: "Implementation in Progress", position: 3, kind: "open", winProbability: null, requiredFields: ["onboarding.kickoff_date"] },
  { pipeline: "onboarding", key: "implementation_done", name: "Implementation Done", position: 4, kind: "open", winProbability: null, requiredFields: [] },
  { pipeline: "onboarding", key: "hypercare", name: "HyperCare", position: 5, kind: "open", winProbability: null, requiredFields: [] },
  { pipeline: "onboarding", key: "handed_to_cs", name: "Handed to CS", position: 6, kind: "won", winProbability: null, requiredFields: ["onboarding.nps", "org.csm"] },
  { pipeline: "onboarding", key: "on_hold_billing", name: "On Hold · Billing", position: 7, kind: "hold", winProbability: null, requiredFields: [] },
];

export const ALL_STAGES = [...SALES_STAGES, ...ONBOARDING_STAGES];
