# LimeCRM — Salesmate teardown & build plan

_Drafted 2026-10-20. Sources: live Salesmate data (~170 deals sampled across all 4 pipelines via the Salesmate MCP), Notion ("Salesmate CRM: API Patterns, Deal Structure & Pipeline Reference", "SOP - Salesmate - April 2026", "SOP - SalesMate" (marketing), "Moving to INR & MRR", "Sales Plan — August 2026", "CS Mid Market Dashboard", "AI collections agent (brief)"), and Slack (#initiative-hubspot-replacement, #ops-mm-onboarding, #onboarding-sales-handoff, #team-customer-success, #enterprise-client-list, #addendum-requests)._

---

## 1. TL;DR

- We went live on Salesmate on 2026-04-01 (from HubSpot). We use a narrow slice of it: **contacts, companies, deals in 4 pipelines, activities, custom fields, a few automations, list views and reports**. We don't rely on sequences, calling, or Salesmate's AI. The original HubSpot evaluation said the same: "we mainly just use the deals and reporting section."
- Salesmate has quietly become the **billing source of truth** (MRR for invoicing, the active-client list, churn dates, CSM ownership). That's the real reason to own it. Finance, Onboarding (AccountPulse), CS (Mid-Market dashboard), the collections agent and the AI SDR all read from it, and every one of them is fighting its API.
- The biggest structural flaw to fix rather than copy: **one sale becomes 3 separate deal records** (Sales → Onboarding → CS pipelines are clones, e.g. "(Pepe jeans) GOAT Brand Labs – Marketing – Upsell" = deals 18822 / 18903 / 19191). That clone step causes the duplicates, MRR mismatches, missing contracts and owner confusion people keep raising.
- **Plan:** build LimeCRM around one **Account → Deals → Lifecycle** model. MRR comes from contracted line items, handoffs are gated transitions instead of clones, and an API, webhooks and an MCP server are first-class. Ship in 4 phases over about 10–12 weeks, with a shadow-sync period before cutover.

---

## 2. What Salesmate does for us today (reverse-engineered)

> **Full detail lives in [salesmate-inventory.md](salesmate-inventory.md)**, captured from the live app on 2026-10-20: the complete field catalog (116 deal / 51 contact / 40 company custom fields), stage-gate rules, per-stage counts, all 87 reports and the dashboards. This section is the summary.
>
> **Scale:** 50,650 contacts · 17,340 companies · 5,311 open deals · 20,612 activities · 47 active users (32 Core + 12 View-Only seats, 9 Admins) · 87 reports · 10 dashboards. Products, Quotes, Tickets and Goals are **unused** (0 records).

### 2.1 Objects in use

| Object | How we use it | Notes |
|---|---|---|
| **Contact** | Lead record. SDRs create it; BANT scores and lead status live here | ~25 required fields per SOP; deal auto-creates from it |
| **Company** | Account name, HQ city, employee size, industry | Weakly used. Many deals have no primary contact or company |
| **Deal** | Commercial unit. `dealValue` = **monthly MRR in INR** (not TCV) | ~4,870 deals as of Jun 2026; IDs now past 20,000 |
| **Activity** | Call / Meeting / Email / Task | "All activity logged in SalesMate" is a sales-plan rule |
| **Notes / Attachments** | Signed agreements, addenda | Attachments **don't copy** when deals are cloned to OB/CS |
| **Users** | AEs, SDRs, OMs, CSMs, plus "Salesmate Bot" (id 999999) for automations | Paid seats are a bottleneck ("by when can we get seats added…") |

### 2.2 Pipelines & stages (live + documented)

**Sales Pipeline (id 2)**
`New(1) → Contacted(2) → Qualified Meetings(7) → Sales Qualified Leads(8) → Ongoing Discussion(9) → Commercial Discussion(10, 70%) → In Negotiation(5) → Agreement Sent(11, 80%) → Agreement Signed(12, 90%) → Invoice Raised(13) → Handed to Onboarding(14)` + terminal/side: `Handed to CS(17)`, `Sales Churn(38)` (signed but never paid), `Closed Lost(15)`

**Onboarding Pipeline (id 6)** — not in the Notion reference, but live
`New (Untouched) → Not Started → On Sales → Kick off Pending(43) → Implementation in Progress(31) → Implementation Done(32) → HyperCare(44) → Handed to Customer Success from OB(45)` + `On Hold - Billing`, `Billing - POC completed`, `Churned(16)`

**Customer Success Pipeline (id 3)**
`All deals(37)`, `Active Deals(18)`, `Billing on Hold(19)`, `Renewal Deal Present`, `Churned(16)`

**Reconnect Pipeline (id 4)** — nurture/recycle (2,605 open, 2,260 untouched)
`New (Untouched)(6)`, `Reconnect in 1 month(20)`, `in 3 months(21)`, `in 6 months(22)`, `Reconnect Enterprise(23)`

**Default Pipeline** (legacy from the HubSpot import, 37 open deals): New → Contacted → Proposal Presented → In Negotiation → …

Stage IDs are shared across pipelines (e.g. `16 Churned` appears in both OB and CS). **Deal status is effectively unused.** Terminal stages hold "Open" deals: Sales has 903 in Handed to Onboarding and 112 in Closed Lost, and CS has 545 in Churned, all with status = Open.

**Live open-deal counts (2026-10-20):** Sales 1,304 · Onboarding ~508 · CS 857 (280 "Active Deals" = ₹65.7L, the closest thing to a live MRR book) · Reconnect 2,605 · Default 37.

### 2.3 Field schema

**Contact (lead) fields** (SOP Apr 2026 + Marketing SOP):
first/last name, email, phone, job title, owner (SDR → AE once a meeting is booked), **Authority / Need / Budget / Timeline scores + BANT total**, HQ city, country, region, employee size, contact source, original source, meeting booking channel, plan, industry, industry type (D2C / Non-D2C), **lead status** (Not Contacted, Attempted, Ongoing, Deferred, Meeting Scheduled, Meeting Completed, Qualified Meeting 50–75, SQL 75+, Disqualified + reason, Duplicate), **lead stage** (MQL, inbound only), meeting scheduled date, meeting completed date, sales accepted date / lead, SQL date, SDR, partner name, product type, website URL, website traffic range, company name, company type (Enterprise).

**Deal fields** (decoded from the API):
standard: title, pipeline, stage, dealValue (MRR INR), status (Open/Won/Lost), lostReason, winProbability, priority, source, owner, primaryContact, primaryCompany, estimatedCloseDate, closedDate, lastActivityAt, tags
custom: `textCustomField9` deal type (New Business / Renewal), `13` engagement level, `14` segment (Enterprise / Mid Market), `27` city, `29` inbound source, `31` category, `37` pricing tier, `44` revenue range, `multiSelect4` employee size, `multiSelect8` product type (Chat BOT, Voice, …), plus "Monthly Invoice Value", "Active Products", per-seat pricing and messaging cost.

**Correction after checking the live app:** most of the fields Onboarding asked for in July **now exist**: LC Account ID, Contract Link, NPS, Kickoff Date, Nature Of The Account, VOICE Adoption / VOICE AI Agreement, Wallet, Billing Status. Pricing is already a ~25-field **rate card** (per-agent fee, per-bot-session with T0–T6 slabs, WA marketing/utility, voice per-minute, SMS, email, image AI, free allowances, implementation fee). Still missing: client-o Slack channel name, and DM email and designation on the deal. BANT score fields from the April SOP are **not** on contacts any more.

**Stage gates already exist** as conditional-required rules. For example, the rate-card fields are required from Agreement Sent, LC Account ID and Contract Link from Invoice Raised, Kickoff Date at Implementation in Progress, and NPS at OB → Handed to CS. The full table is in the inventory, §3. LimeCRM's transition gates should start from this list.

**Duplicate concepts to merge:** Company Type / Deal Level / Nature Of The Account / Account Classifier · Product Type / Products in Scope / Product Module / Type of Bot · Owner / "Contact owner" / Account Executive (text) · Contact Source / Contact Source (Cloned) / Source. Several HubSpot leftovers should not be migrated.

### 2.4 Automations & conventions

| Behaviour | Today |
|---|---|
| Contact → Deal auto-creation | When the SDR completes required fields and moves the owner to the AE after the meeting. Brittle ("deal is not getting auto-created, I updated all the fields") |
| Referrals | Auto-create a deal with source = Referrals |
| Upsell | Manually created deal on the same POC, counted as closed when the subscription is created |
| Cross-sell | New POC marked SQL → automation creates the deal; closed on first invoice (prepaid) or after the subscription update (postpaid) |
| Churn alerts | A Salesmate flow (built by Kanika) |
| Handoff Sales → OB → CS | **A new deal is created in each pipeline** (clone) |
| Win probability | Defaults by stage (70 / 80 / 90) |
| Currency/metric | INR, MRR only. Annual = 1.5× and bi-annual = 1.25× multipliers are applied **outside** the CRM for incentives |

### 2.5 Reports & views people depend on

- **Sales:** New-business MRR by AE vs target (Kopal ₹1.5L, Malavika ₹1.8L, Shubhang ₹1.6L, Pankit ₹4.4L/qtr), SQLs by SDR and segment (team 38/month), partnership MRR (Sayantan ₹1.4L), voice-deal count, and **"SalesMate hygiene" (5% of AE variable pay)**.
- **Onboarding:** accounts and MRR moved to Success, deals by OB stage, kick-off pending.
- **CS:** active MM clients list view, MRR per account, CSM owner, current deals, churns, enterprise tiers (Platinum > ₹1L MRR, Gold ₹70k–1L).
- **Finance:** monthly recon of "closed in Salesmate" against billed revenue (e.g. Jul: ₹6.89L new closed vs ₹72k billed), active-client list for invoicing.
- **Leadership:** revenue dashboards (the original HubSpot-replacement requirement).

### 2.6 Downstream consumers (the "internal apps")

| Consumer | Reads | Pain today |
|---|---|---|
| **AccountPulse** (OB dashboard, Vercel) | New accounts, MRR, owner, stage changes and dates | "Salesmate updates aren't reflecting", stale sync, duplicate accounts |
| **CS Mid-Market Dashboard** (planned) | MRR, CSM owner, current deals | Needs per-account rollup that Salesmate doesn't model |
| **AI collections agent** (Finance) | Client phone and payment status | "Finance data may not be in Salesmate reliably" |
| **AI SDR** (bitscale + Claude) | Writes leads / meetings | Manual logging |
| **Salesmate MCP** (Claude) | Deals | Only `search_deals` works. `get_deal`, contacts, companies, activities and users return errors (confirmed today) |
| **Slack** | Deal links pasted into #addendum-requests, #prospect-*, #updates-demo-page-leads | No unfurl, no bidirectional updates |
| **LimeChat Helpdesk** (Rails monolith, has Chargebee) | — | No link today; LC Account ID missing from the CRM |

---

## 3. Problems to fix, not copy

1. **Clone-per-pipeline.** Three records per sale means MRR drift, lost attachments, double-counted accounts (EverQ/Puresta, Aferelle) and an endless argument over whether the AE or the OM owns the record.
2. **MRR is typed by hand** but drives billing. The rate card is there as ~25 flat fields, but "Monthly Invoice value" and deal `Value` are entered separately and nothing ties them to the rate card. The Chargebee Subscription ID field exists but is free text with no sync.
3. **No Account object with lifecycle.** "Is this client active / onboarding / churned?" means scanning deals across 3 pipelines.
4. **State contradictions in the data.** Deals sit at stage "Closed Lost" with status "Open" (e.g. 10881, 18705). Hundreds of legacy deals are parked at "Handed to Onboarding" with no close date. Deals are missing their primary contact. Value is 0 in OB/CS clones.
5. **Weak validation.** Required fields are enforced by SOP and the hygiene bonus, not by the system.
6. **API is unreliable.** Server-side filters fail, `totalRows` returns 0, and every consumer has to page through all ~5k deals and filter locally.
7. **Seat economics.** Read-only users still need paid seats, so CS, OB and Finance go without access or route updates through one person.
8. **Security.** The Salesmate API access token is pasted in plain text in a Notion page in the AI Knowledge Base. **Rotate it now** regardless of this project.

---

## 4. Target design for LimeCRM

### 4.1 Core model

```
Organization (customer company)  ── 1:N ── Contact (person, BANT, lead status)
   │  lc_account_ids[], chargebee_customer_id, segment, account_type, tier,
   │  lifecycle_stage (Prospect → Onboarding → Active → On Hold → Churned),
   │  owners: AE, OM, CSM (role-based, not one "owner")
   │
   ├── 1:N ── Deal (one commercial event: New / Upsell / Cross-sell / Renewal / Addendum)
   │             pipeline = Sales only; stages 1→14 + Lost/Sales Churn
   │             ├── 1:N ── DealLineItem (product, unit, qty, unit_price, billing_cycle)
   │             │            → mrr = Σ normalized monthly value  (derived, not typed)
   │             │   ↳ seeded from today's rate-card fields: platform fee, per-agent fee + free agents,
   │             │     per-bot-session + slabs T0–T6 + free sessions, WA marketing/utility,
   │             │     voice per-minute + free minutes, inbound/outbound calling, SMS, email,
   │             │     image AI, one-time implementation fee
   │             └── Contract (link, signed_at, parties, file)
   │
   ├── 1:1 ── Onboarding (kick-off date, OM, stage 43→45, hypercare, NPS on exit)
   ├── 1:N ── Subscription snapshot (from Chargebee: current MRR, invoice status)
   ├── 1:N ── Activity (call/meeting/email/task/note; polymorphic to org/contact/deal)
   └── 1:N ── StageEvent (audit log: who moved what, from→to, when)  ← powers all "date of X" reports
```

Key decisions:
- **Handoffs are transitions, not copies.** "Handed to Onboarding" closes the deal as Won and opens the Org's Onboarding record. "Handed to CS" moves the Org's lifecycle to Active and assigns a CSM. One record and one MRR number all the way through.
- **Gates on transitions.** For example Sales → OB requires MRR line items, per-seat price, messaging cost, DM email and designation, products in contract, contract link, LC Account ID and client-o channel. OB → CS requires NPS. These are the requirements OB already wrote down.
- **LimeCRM is the source of truth (decided).** Deal line items are *contracted* MRR and the authoritative number for billing, the active-client list and churn. Chargebee's *billed* MRR is pulled in only to reconcile against it, and mismatches land in an exceptions queue for Finance. The Finance recon becomes a built-in report instead of a spreadsheet.
- **Reconnect** becomes a nurture status with a `reconnect_on` date on the Org or Contact, not a pipeline.
- **Lead → Deal** stays automatic (SQL + AE owner), as a server-side rule that reports what blocked it.

### 4.2 Feature parity checklist

| Area | MVP (cutover) | Later |
|---|---|---|
| Records | Orgs, contacts, deals, line items, activities, notes, attachments/links | Custom-field builder in UI |
| Pipelines | Kanban + list per pipeline, drag to move, stage gates, win-prob defaults | Configurable pipelines/stages in UI |
| Views | Saved filtered list views (shareable URL), bulk edit, CSV import/export | Column personalization |
| Automations | Lead→deal, referral deal, churn alert, stage-change Slack notifications, stale-deal reminders | Visual rule builder |
| Reports | AE MRR vs target, SDR SQLs, OB→CS throughput, active-client list, churn, booked-vs-billed recon, hygiene score | Forecasting, cohort NRR |
| Access | Google SSO (limechat.ai), roles: Admin / Sales / OB / CS / Finance / Viewer, **free read-only** | Field-level permissions |
| Audit | StageEvent + field-change history on every record | — |
| Search | Global search across orgs, contacts and deals | — |

Explicitly **not** building now: email sequences, dialer and call recording, contact enrichment (Apollo / bitscale do these), Salesmate's AI.

### 4.3 Integrations (the reason we're doing this)

| Integration | Direction | MVP? |
|---|---|---|
| **REST API + webhooks** (record.created / updated / stage_changed) | out | ✅ — AccountPulse, CS dashboard and collections read from here |
| **MCP server** (search/get/update deals, orgs, contacts, activities, log activity) | in/out | ✅ — replaces the broken Salesmate MCP |
| **Google Calendar / Gmail** → activities, meeting-completed dates | in | ✅ calendar; Gmail later |
| **Slack**: deal-link unfurls, stage-change posts, create client-o channel + add Metric Bot on handoff | out | ✅ |
| **Chargebee**: customer and subscription link, billed MRR, invoice status | in | Phase 3 |
| **LimeChat Helpdesk** (Rails): LC Account ID lookup, account creation on handoff | in/out | Phase 3 |
| **Website demo form / AI SDR** → lead creation via API | in | Phase 2 |
| **Metabase**: read replica or reporting schema | out | Phase 2 |

### 4.4 Suggested stack (open decision, see §7)

- **Next.js (App Router) + TypeScript + Postgres (Prisma or Drizzle)**, background worker (pg-boss/BullMQ) for sync, automations and webhooks. Google SSO. This matches the AccountPulse build style (Vercel), so the same people can ship it fast.
- Alternative: a Rails engine next to the LimeChat monolith. That gives native access to accounts and Chargebee, but couples CRM releases to the core product.
- Postgres as system of record, with Metabase pointed at a read replica.

---

## 5. Migration plan

1. **Rotate the Salesmate token**, store the new one in a secret manager, and never paste it in docs again.
2. **Full extract** with the raw API (not the MCP): `POST /apis/deal/v4/search?rows=250&from=N` to list all deals, then `GET /apis/deal/v4/{id}` per deal for custom fields. Do the same for contacts, companies, activities, notes, attachments and users. Snapshot to object storage as JSON.
3. **Transform:**
   - Map custom-field ids to named columns (table in §2.3).
   - **Collapse clones:** group Sales + OB + CS deals for the same org and offering into one Deal + Onboarding + lifecycle. Use title, primary contact and company as match keys, with a manual review queue for low-confidence groups.
   - Rebuild StageEvents from `closedDate`, `lastModifiedAt` and pipeline membership where possible. Mark the rest as "migrated, unknown date".
   - Normalize: status vs stage contradictions, null close dates, `lastActivityAt` (unix) vs ISO dates.
   - Keep `salesmate_id` on every row. Redirect `limechat.salesmate.io/#/app/deals/{id}` links through a lookup page.
4. **Shadow period (2–3 weeks):** nightly one-way Salesmate → LimeCRM sync. Point AccountPulse and the CS dashboard at LimeCRM read-only. Reconcile MRR totals by segment, owner and active-client count daily until the diff is zero.
5. **Cutover:** freeze Salesmate edits, run a final sync, flip writes to LimeCRM, keep Salesmate read-only for one billing cycle, then export an archive and cancel.

---

## 6. Phased roadmap

**Progress (2026-10-20):** Stack and model decided (Next.js + Postgres, single company record). Phase 1 foundation is built and running locally:
- **Done:** schema and migrations · stages and gates seeded from Salesmate's rules · deal transitions with gates and the won → onboarding → active handoff · churn · MRR computed from line items · audit events and timelines · deals board, deal page, companies, company page, onboarding board · REST v1 (read + transition) · unit tests.
- **Also done (2026-10-20):**
  - LimeChat Design System V3, using the same Mantine theme as LimeNotes.
  - Google SSO and roles (Finance/Admin-only billing fields on won deals).
  - **Leads:**
    - A lead list with search, filters and status chips, and a lead page.
    - BANT scoring that totals as you type.
    - SOP status checks: meeting dates, a reason to disqualify, and AE, product interest and BANT ≥50/75 to qualify.
    - Reaching Qualified Meeting or SQL auto-creates the company's deal at the matching stage (or reuses its open deal).
- **In progress:** Salesmate export and transform, waiting on a rotated API token.
- **Also done (2026-10-21):** Reports v1 (MRR booked, pipeline/forecast, SDR funnel, customer book and churn, onboarding throughput) · per-user API keys, REST v1 and an MCP server at /api/v1/mcp · **My work** (tasks with due dates: overdue/today/upcoming, Mine/Team; stale open deals with no touch in 14+ days) · **global search** (header, ⌘K) across companies, deals and people.
- **Also done:** CSV export of deals, companies and leads (leads keep the page filters; formula-safe) · lead CSV import (auto-matched columns, preview with per-row problems, skips people already in LimeCRM by email, SDR/AE by email).
- **Also done:** saved views on Leads (name a filtered list, private or shared with the team; owner or admin can delete).
- **Also done:** Slack notifications through an outbox (wins, losses, handover to CS, churn alerts, renewal reminders 30/7/1 days, morning digest DMs, client-o channel on first win), admin Notifications page, cron jobs (vercel.json). Waiting on the Slack app token.
- **Also done (2026-10-22):**
  - **Slack is live** in a sandbox channel: `pnpm slack:check`, colour bars in the LimeChat palette, a bot icon, and `SLACK_SANDBOX_CHANNEL_ID` so dev never DMs people or creates client channels.
  - **Branding pass:** branded 404, error and loading screens; design-system date inputs (22 Oct 2026); badges no longer truncate; metric tiles fit on phones; browser tabs show the record's name.
  - **Interim Salesmate load through the MCP** (`migrate:extract-mcp`): open deals only, with no custom fields.
  - **Old Salesmate links** (`/salesmate/deals/<id>`, or pasted into search) open the migrated deal.
  - **Lead intake API** (`POST /api/v1/leads`, MCP `create_lead`) for the website form and the AI SDR. It doesn't duplicate people already in LimeCRM.
  - **Outbound webhooks** (Settings → Webhooks), signed and retried.
  - **Drag and drop** on the Deals and Onboarding boards.
  - **Reconnect** as nurture dates with a list and daily AE tasks. The migration turns the Reconnect pipeline into these dates.
  - **Bulk edit** on Leads (SDR, AE, status, with the SOP checks per lead) and Companies (AE with their open deals, OM, CSM, segment, reconnect). Companies gained filters.
  - **CRM hygiene report** (the 5% of AE variable). AEs are scored on stage fields, close date, a touch in 14 days, a next step and a primary contact; SDRs on status fields and a touch in 14 days. The report has a fix list and a CSV. Imported deals keep Salesmate's last-modified date, so staleness is right from day one.
  - **Conversion funnel report** (replaces the SDR funnel card): Lead → Meeting scheduled → Meeting completed → Qualified meeting → SQL → Deal won, with count, conversion from the previous step and from the top, and median days per step. Cohort by leads created in the period or by events in the period; cut by SDR, AE, source, segment, product interest or month, optionally split by month; CSV of the per-group rows. Step 1 of the reporting plan in hubspot-gaps.md §2.
- **Not done yet:**
  - **Email campaigns on Postmark (built 2026-10-22, waiting on Postmark setup):** active lists, a branded block editor with live preview, test send, schedule or send now, subscription types, public preference page, one-click unsubscribe, bounce and complaint suppression, results per campaign.
  - **Gmail sync (built 2026-10-22, waiting on Google setup):** each person connects their Gmail; emails are logged on records, and new people a rep writes to become contacts. It needs the Gmail API and the `gmail.readonly` scope on the sign-in OAuth client.
  - Needs credentials: Google Calendar (Google OAuth app) · Chargebee link and booked-vs-billed recon (Chargebee API key) · Helpdesk link (Helpdesk API) · full Salesmate extract and cutover (rotated Salesmate token).
  - Can be built without credentials: Metabase reporting schema.

| Phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| **0. Discovery & extract** | 1 | Token rotation, full Salesmate export, field and stage census with real counts, interviews with Sales / OB / CS / Finance (30 min each), sign-off on §4.1 | Signed-off data model; complete JSON snapshot |
| **1. Core CRM** | 2–5 | Auth/roles, Orgs/Contacts/Deals/Line items/Activities, pipelines + kanban, gates, list views, audit log, CSV import, REST API, MCP server | Sales team can run a week in LimeCRM on migrated data (staging) |
| **2. Ops & reporting** | 5–8 | Onboarding and lifecycle, automations (lead→deal, churn, reminders), Slack, Calendar, the reports in §2.5, webhooks, demo-form/AI-SDR ingest, Metabase replica | AccountPulse and CS dashboard switched to the LimeCRM API in shadow mode |
| **3. Billing link & cutover** | 8–11 | Chargebee + Helpdesk links, booked-vs-billed recon, shadow-sync reconciliation, cutover, Salesmate read-only | MRR diff = 0 for 5 consecutive days; cutover done |
| **4. Beyond parity** | 12+ | AI deal summaries and next steps from activity, hygiene auto-scoring, renewal and upsell signals from usage (ClickHouse / lc_analytics), forecasting | — |

Team sketch: 1 full-stack lead + 1 engineer, about 0.25 of a RevOps owner (Kanika or Javeed know the current config best), and a named owner each from Sales, OB, CS and Finance for gate definitions and UAT.

---

## 7. Decisions needed from you

1. **Stack:** standalone Next.js + Postgres (recommended) or a Rails engine inside the LimeChat monolith?
2. **Model change sign-off:** OK to kill clone-per-pipeline in favour of one Org lifecycle? This changes how OB and CS work day to day.
3. ~~**MRR source of truth for billing**~~ — **Decided 2026-10-20: LimeCRM is the source of truth.** Contracted line items in LimeCRM define MRR. Chargebee billing is reconciled *against* LimeCRM, and any mismatch is flagged as a LimeCRM exception.
4. **Scope of "all functionalities":** confirm sequences, dialer and enrichment are out (Apollo / bitscale cover them).
5. **Owner and timeline:** who builds it, and is there a hard date (Salesmate renewal date)?
6. **Hosting and data residency:** our infra (same cloud as LimeChat) or Vercel + managed Postgres like AccountPulse?

## 8. Gaps in this teardown

- ✅ Closed on 2026-10-20 via a browser walkthrough: per-stage counts, the full custom-field list, stage-gate rules, the report catalog and the user/seat model (see [salesmate-inventory.md](salesmate-inventory.md)).
- ⏳ **Needs an Admin login (Kanika or Javeed):** Smart Flows (workflows/automations: lead→deal, churn alerts, "days spent in stage" counters, clone-to-OB/CS), Sequences, Web Forms, Setup (layouts, duplicate rules, profiles/permissions, integrations, webhooks). These define the automations LimeCRM must replicate.
- ⏳ Report *definitions* (filters and group-bys) for the ~70 custom reports. The names are captured, and the definitions can be exported by an admin or read from each report's edit screen.
