import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { activityType, lifecycle, userRole } from "@/db/schema";
import { OPERATION_SCOPE, type ApiOperation } from "@/domain/api-keys";
import { LEAD_STATUSES } from "@/domain/leads";
import { SALES_STAGES } from "@/domain/stage-config";
import {
  activityInput,
  callerMay,
  changeLeadStatus,
  createActivity,
  getDealDetail,
  getLeadDetail,
  getOrganizationDetail,
  listApiUsers,
  moveDeal,
  searchDeals,
  searchLeads,
  searchOrganizations,
  type ApiCaller,
  type ApiFailure,
} from "@/server/api";

/**
 * LimeCRM's MCP tools, replacing the Salesmate MCP. One server per request (stateless), bound to
 * the caller's API key: reads need the `read` scope, writes the `write` scope plus the key owner's
 * role, exactly as /api/v1.
 */

// How money works in LimeCRM. Repeated where it matters so a model never has to guess.
const MONEY = [
  "Money: `mrr` is monthly recurring revenue in the deal's `currency` (INR for almost every deal; USD deals are not converted).",
  "It is computed from the deal's line items, normalized to a month (an annual ₹1,20,000 item counts as ₹10,000 MRR), and can't be set directly.",
  "One-time charges (implementation fees) are in `oneTimeFee`, never in MRR. Only won deals count as revenue; an open deal's MRR is pipeline.",
  "An organization's `contractedMrr` is the sum of MRR of its won deals whose contract hasn't ended (`endedAt` empty), and 0 once churned.",
  "Amounts are plain numbers in rupees, not lakhs or crores (1,00,000 = 1 lakh = 100000).",
].join(" ");

const STAGE_KEYS = `${SALES_STAGES.map((s) => s.key).join(", ")} (in pipeline order; won is "Won · Handed over")`;
const LEAD_STATUS_KEYS = LEAD_STATUSES.map((s) => s.key) as [string, ...string[]];

const json = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const refuse = (f: ApiFailure, hint?: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: f.error, ...(f.missing ? { missing: f.missing } : {}), ...(hint ? { hint } : {}) }, null, 2) }],
});
const notFound = (what: string): CallToolResult => refuse({ ok: false, status: 404, error: `${what} not found` });

/** Compact deal row for search results. get_deal has everything. */
type DealRow = Extract<Awaited<ReturnType<typeof searchDeals>>, { ok: true }>["data"][number];
const dealSummary = (d: DealRow) => ({
  id: d.id,
  title: d.title,
  orgId: d.orgId,
  orgName: d.orgName,
  stage: d.stage,
  stageKey: d.stageKey,
  status: d.status,
  type: d.type,
  mrr: d.mrr,
  oneTimeFee: d.oneTimeFee,
  currency: d.currency,
  owner: d.ownerName,
  ownerEmail: d.ownerEmail,
  expectedCloseDate: d.expectedCloseDate,
  closedAt: d.closedAt,
  endedAt: d.endedAt,
  updatedAt: d.updatedAt,
});

export function buildMcpServer(caller: ApiCaller) {
  const server = new McpServer(
    { name: "limecrm", version: "1.0.0" },
    {
      instructions: [
        "LimeCRM is LimeChat's CRM and the source of truth for deals, MRR, the active-client list and churn (it replaces Salesmate).",
        "Organizations are customers (lifecycle prospect → onboarding → active → on_hold → churned). Deals move through the Sales pipeline only; winning one opens the organization's onboarding.",
        "Leads are people SDRs work; reaching qualified_meeting or sql opens a deal automatically.",
        MONEY,
        `Writes act as the API key's owner (${caller.user ? `${caller.user.name}, role ${caller.user.role}` : "no owner"}) with the same permissions and stage gates as the LimeCRM UI.`,
      ].join("\n"),
    },
  );

  /** Registers a tool whose scope check runs before the handler. */
  const tool = <Shape extends z.ZodRawShape>(
    name: ApiOperation,
    config: { title: string; description: string; inputSchema: Shape },
    run: (args: z.infer<z.ZodObject<Shape>>) => Promise<CallToolResult>,
  ) =>
    server.registerTool(
      name,
      {
        ...config,
        annotations: {
          title: config.title,
          readOnlyHint: OPERATION_SCOPE[name] === "read",
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      (async (args: z.infer<z.ZodObject<Shape>>) => {
        const may = callerMay(caller, name);
        if (!may.ok) return refuse(may);
        return run(args);
      }) as never, // the SDK can't infer a callback type through a generic shape
    );

  // ---------- deals ----------

  tool(
    "search_deals",
    {
      title: "Search deals",
      description: [
        "Find deals in the Sales pipeline, most recently updated first. All filters are optional and combine with AND.",
        "Returns { total, deals: [...] } with each deal's id, title, organization, stage, status (open/won/lost), mrr, currency and owner.",
        MONEY,
        "To list a customer's live contracts, filter status=won and ignore deals with an endedAt.",
      ].join(" "),
      inputSchema: {
        query: z.string().optional().describe("Text to match in the deal title or organization name"),
        stage: z.string().optional().describe(`Sales stage key or name, e.g. ${STAGE_KEYS}`),
        status: z.enum(["open", "won", "lost"]).optional(),
        owner: z.string().optional().describe('Deal owner (AE): a user id, an email, or "me" for this API key\'s owner. See list_users.'),
        orgId: z.string().uuid().optional().describe("Only deals of this organization"),
        limit: z.number().int().min(1).max(200).default(25),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ query, ...filters }) => {
      const res = await searchDeals({ q: query, ...filters }, caller);
      return res.ok ? json({ total: res.total, deals: res.data.map(dealSummary) }) : refuse(res);
    },
  );

  tool(
    "get_deal",
    {
      title: "Get deal",
      description: [
        "Everything about one deal: fields, organization, owner and SDR, pricing line items (each with its monthlyValue),",
        "and `stages`: every Sales stage with the fields still `missing` to move there (empty = the gate is met).",
        "Check `stages` before calling update_deal_stage.",
        MONEY,
      ].join(" "),
      inputSchema: { dealId: z.string().describe("Deal id (uuid)") },
    },
    async ({ dealId }) => {
      const deal = await getDealDetail(dealId);
      return deal ? json(deal) : notFound("Deal");
    },
  );

  tool(
    "update_deal_stage",
    {
      title: "Move deal to a stage",
      description: [
        "Move a deal to another Sales stage, as the API key's owner, with the same rules as the LimeCRM UI.",
        "Each stage has a gate of required fields (carried forward from earlier stages). If it isn't met, nothing changes and the",
        "result is an error listing the `missing` fields (key and label): ask the user for them or fill them in LimeCRM, then retry.",
        "Moving to won is the billing handoff: the deal's MRR starts counting as contracted revenue and the organization's onboarding opens.",
        "Only Finance or Admin can move a deal out of won. Use get_deal first to see each stage's missing fields.",
      ].join(" "),
      inputSchema: {
        dealId: z.string().describe("Deal id (uuid)"),
        stage: z.string().describe(`Target Sales stage key, e.g. ${STAGE_KEYS}`),
      },
    },
    async ({ dealId, stage }) => {
      if (!caller.user) return refuse({ ok: false, status: 403, error: "Writes need a per-user API key" });
      const res = await moveDeal(caller.user, dealId, stage);
      if (res.ok) return json({ ok: true, ...res.data, deal: await getDealDetail(dealId).then((d) => d && { stage: d.stage, status: d.status, mrr: d.mrr }) });
      return refuse(res, res.missing ? "The stage's requirements aren't met. Fill the missing fields in LimeCRM, then retry." : undefined);
    },
  );

  // ---------- organizations ----------

  tool(
    "search_organizations",
    {
      title: "Search organizations",
      description: [
        "Find organizations (LimeChat's customers and prospects), highest contracted MRR first.",
        "`query` matches the name or website, or a LimeChat account id when it's a number.",
        "lifecycle: prospect (not yet won), onboarding (won, being set up), active (live customer), on_hold, churned.",
        "The active customer book is lifecycle=active plus onboarding and on_hold.",
        MONEY,
      ].join(" "),
      inputSchema: {
        query: z.string().optional(),
        lifecycle: z.enum(lifecycle.enumValues).optional(),
        limit: z.number().int().min(1).max(500).default(25),
      },
    },
    async ({ query, ...filters }) => {
      const res = await searchOrganizations({ q: query, ...filters });
      return res.ok ? json(res.data) : refuse(res);
    },
  );

  tool(
    "get_organization",
    {
      title: "Get organization",
      description: [
        "One organization with its owners (aeId, omId, csmId), LimeChat account ids, Chargebee customer id, health, churn details,",
        "all its deals (with stage), contacts and onboardings. contractedMrr is the live MRR of the account.",
        MONEY,
      ].join(" "),
      inputSchema: { orgId: z.string().describe("Organization id (uuid)") },
    },
    async ({ orgId }) => {
      const org = await getOrganizationDetail(orgId);
      return org ? json(org) : notFound("Organization");
    },
  );

  // ---------- leads ----------

  tool(
    "search_leads",
    {
      title: "Search leads",
      description: [
        "Find leads (people SDRs are working), most recently updated first, up to 100, plus a count per lead status for the same filters.",
        "Each lead has its status, BANT scores (0–25 each; bantTotal ≥ 50 qualifies a meeting, ≥ 75 is an SQL), company, owner (AE) and SDR.",
      ].join(" "),
      inputSchema: {
        query: z.string().optional().describe("Matches name, email or company"),
        status: z.enum([...LEAD_STATUS_KEYS, "none"]).optional().describe('Lead status, or "none" for contacts that aren\'t leads'),
        owner: z.string().optional().describe('Owner (AE): user id, email or "me"'),
        sdr: z.string().optional().describe('SDR: user id, email or "me"'),
        limit: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ query, limit, ...filters }) => {
      const res = await searchLeads({ q: query, ...filters }, caller);
      return res.ok ? json({ counts: res.counts, leads: res.data.slice(0, limit) }) : refuse(res);
    },
  );

  tool(
    "get_lead",
    {
      title: "Get lead",
      description: "One lead with BANT scores and total, meeting dates, company, and the company's deals.",
      inputSchema: { leadId: z.string().describe("Lead (contact) id, uuid") },
    },
    async ({ leadId }) => {
      const lead = await getLeadDetail(leadId);
      return lead ? json(lead) : notFound("Lead");
    },
  );

  tool(
    "set_lead_status",
    {
      title: "Set lead status",
      description: [
        "Move a lead to a new status, as the API key's owner, with the SDR SOP's requirements.",
        `Statuses in working order: ${LEAD_STATUS_KEYS.join(", ")}.`,
        "meeting_scheduled needs a meeting date; meeting_completed a completed date; disqualified a reason;",
        "qualified_meeting and sql need a company, completed meeting, owner, product interest and all four BANT scores (total ≥ 50, or ≥ 75 for sql).",
        "If they aren't met, nothing changes and the result lists the `missing` fields.",
        "Reaching qualified_meeting or sql opens a deal for the company (or links its open deal) and returns its dealId.",
      ].join(" "),
      inputSchema: { leadId: z.string(), status: z.enum(LEAD_STATUS_KEYS) },
    },
    async ({ leadId, status }) => {
      if (!caller.user) return refuse({ ok: false, status: 403, error: "Writes need a per-user API key" });
      const res = await changeLeadStatus(caller.user, leadId, status);
      return res.ok ? json(res.data) : refuse(res);
    },
  );

  // ---------- activities and people ----------

  tool(
    "log_activity",
    {
      title: "Log activity",
      description: [
        "Record a call, meeting, demo, email, note or other touchpoint on an organization, deal and/or contact, as the API key's owner.",
        "Give at least one of orgId, dealId, contactId; the organization is filled in from the deal or contact.",
        "Without dueAt it is logged as done now; with dueAt (and no completedAt) it is an open task.",
        "It shows on the record's timeline in LimeCRM.",
      ].join(" "),
      inputSchema: {
        type: z.enum(activityType.enumValues),
        subject: z.string().min(1).describe("One-line summary"),
        body: z.string().optional().describe("Notes"),
        orgId: z.string().uuid().optional(),
        dealId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        dueAt: z.string().optional().describe("ISO 8601 date-time with offset, e.g. 2026-10-22T15:00:00+05:30"),
        completedAt: z.string().optional().describe("ISO 8601 date-time with offset; defaults to now unless dueAt is given"),
      },
    },
    async (args) => {
      if (!caller.user) return refuse({ ok: false, status: 403, error: "Writes need a per-user API key" });
      const input = activityInput.safeParse(args);
      if (!input.success) {
        return refuse({ ok: false, status: 400, error: input.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      }
      const res = await createActivity(caller.user, input.data);
      return res.ok ? json(res.data) : refuse(res);
    },
  );

  tool(
    "list_users",
    {
      title: "List users",
      description:
        "Active LimeCRM users (id, name, email, role), to resolve owners, AEs, CSMs and SDRs. Roles: admin, sales, onboarding, cs, finance, viewer.",
      inputSchema: { role: z.enum(userRole.enumValues).optional() },
    },
    async ({ role }) => json(await listApiUsers(role)),
  );

  return server;
}
