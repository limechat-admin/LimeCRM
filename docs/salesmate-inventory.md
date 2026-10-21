# Salesmate inventory (reverse-engineered spec)

_Captured 2026-10-20 from limechat.salesmate.io while signed in as Nikhil (Standard profile, not Admin). Read-only: nothing was edited. Sources: the app's field-metadata endpoint, the deal board and list views, the Reports 2.0 library, the Dashboards list, and the users/teams payload._

**Not visible to this account (needs an Admin, e.g. Kanika or Javeed):** Setup (pipeline config, layouts, duplicate rules, profiles/permissions, integrations, webhooks), **Smart Flows (workflows/automations)**, Sequences, Web Forms, Meetings scheduler.

---

## 1. Scale

| Object | Count | Notes |
|---|---|---|
| Contacts | 50,650 | 41 saved views (incl. "Leads") |
| Companies | 17,340 | 4 saved views |
| Deals (status = Open) | 5,311 | 37 saved views; across 5 pipelines |
| Activities | 20,612 | Types: Call, Task, Meeting Set, Demo, Mid Market Activity, LinkedIn, Attempted Contact, Email Follow Up, WhatsApp Follow Up |
| Users | 59 (47 active) | 32 Core seats, 12 View-Only, 3 mixed. Profiles: 38 Standard, **9 Admin**. Roles: flat (45 "Manager", 2 "CEO") |
| Teams | 4 | e.g. "All - MM CS" (6 users, deal distribution = assign to team manager) |
| Reports | 87 | 2 folders: "Mid-Market - CS" (9), "Enterprise team" (3); the rest unfiled |
| Dashboards | 10 shared + 1 system | see §6 |
| Products / Quotes / Tickets / Goals | **0 / 0 / 0 / 0** | Modules exist but are **unused** |

---

## 2. Pipelines & stages (open-deal counts and value, 2026-10-20)

Values are the sum of `Value` (MRR, INR). Note that **status stays "Open" even in terminal stages**: stages are used as states, and Won/Lost status is effectively unused.

### Sales Pipeline — 1,304 open deals
| Stage | # | ₹ |
|---|---|---|
| Qualified Meetings | 41 | 13.6L |
| Sales Qualified Leads | 35 | 12.2L |
| Ongoing Discussion | 32 | 25.5L |
| Commercial Discussion | 23 | 20.4L |
| Agreement Sent | 12 | 10.6L |
| Agreement Signed | 6 | 1.3L |
| Invoice Raised | 5 | 9.1L |
| **Handed to Onboarding** | **903** | 1.32Cr |
| Closed Lost | 112 | 22.2L |
| Sales Churn | 30 | 9.1L |
| Handed to CS | 105 | 10.3L |

### Onboarding Pipeline — ~508 open deals
| Stage | # | ₹ |
|---|---|---|
| New (Untouched) | 0 | — |
| Not Started | 0 | — |
| On Sales | 1 | 0.18L |
| Kick off Pending | 38 | 0.09L |
| Implementation in Progress | 46 | **1.04Cr ← outlier, likely a bad value** |
| Implementation Done | 14 | 2.0L |
| HyperCare | 8 | 1.1L |
| On Hold - Billing | 5 | 0.28L |
| Billing - POC completed | 3 | — |
| Handed to Customer Success from OB | 299 | 7.8L |
| Churned | 94 | 8.1L |

### Customer Success Pipeline — 857 open deals
| Stage | # | ₹ |
|---|---|---|
| All deals | 28 | 4.4L |
| **Active Deals** | **280** | **65.7L** ← closest thing to "current MRR book" |
| Billing on Hold | 0 | — |
| Renewal Deal Present | 4 | 0.4L |
| Churned | 545 | 1.12Cr |

### Reconnect Pipeline — 2,605 open deals
| Stage | # | ₹ |
|---|---|---|
| New (Untouched) | 2,260 | 1.10Cr |
| Reconnect in 1 month | 63 | 11.4L |
| Reconnect in 3 months | 125 | 24.3L |
| Reconnect in 6 months | 66 | 15.9L |
| Reconnect Enterprise | 91 | 63.1L |

### Default Pipeline (legacy, from the HubSpot import) — 37 open deals
New (35) → Contacted (1) → Proposal Presented (0) → In Negotiation (1) → …

---

## 3. Stage gates (conditional "required" rules on deal fields)

These rules are what really controls a handoff today. Each field becomes mandatory when the deal enters the listed stages.

| Field(s) | Required when |
|---|---|
| Estimated Close Date, Priority | SQL, Ongoing Discussion, Commercial Discussion, Agreement Sent |
| Account Executive, Brand Website, Business Type, Employee Size, Plan, Product Type | Pipeline = Sales (any stage) |
| Implementation Fees, Per Agent Fee, Cost Per Bot Session, WhatsApp Marketing Charge, WhatsApp Utility Charge, Cost Per Minute, Cost Per SMS | Agreement Sent → Agreement Signed → Invoice Raised → Handed to Onboarding → Handed to CS |
| Products in Scope, Billing Currency, Billing Cycle, Contract Start Date, Contract Renew date, Monthly Invoice value, Type of Bot | Agreement Signed onward |
| LC Account ID, Contract Link, Nature Of The Account, Free Agents, Free Bot Sessions, Free Voice Minutes | Invoice Raised onward |
| Close Date | Deal Stage = Agreement Signed **and** Plan = Enterprise/Custom |
| Why Closed Lost? | Stage = Closed Lost |
| Kickoff Date | Onboarding → Implementation in Progress |
| NPS | Onboarding → Handed to CS |
| VOICE Adoption | Handed to Customer Success from OB |
| Churn – last billing date | CS or OB → Churned |
| Churn reason description, Churn Communication Date | CS → Churned |
| HQ City, Website Backend Store | Always |
| Contact: Product Type | Always |

---

## 4. Field catalog (custom fields only)

Legend: `[options]` are picklist values (truncated where long). ★ = has a stage-gate rule (§3).

### 4.1 Deal — 116 custom fields

**Commercial / pricing (the rate card)**
- Monthly Invoice value (In Billing Currency) ★ · Integer
- Billing Currency ★ `[INR; USD]` · Currency `[INR; USD]`
- Billing Cycle ★ `[Monthly; Quarterly; Annually; Semi Anually; One-Time]`
- Implementation Fees ★ · Mrr value + Implementation fees (Formula)
- Per Agent Fee ★ (Currency) · Free Agents ★
- Cost Per Bot Session ★ · Free Bot Sessions (If Any) ★ · Bot slab pricing (Text) · Cost per Session
- Bot session slab tiers: T0 (0-1k), T0 (1-2k), T1 (2-5k), T2 (5-10k), T3 (10-15k), T4 (15-20k), T5 (20-25k), T6 (25k+)
- WhatsApp Marketing Charge ★ · WhatsApp Utility Charge ★
- Cost Per Minute ★ · Free Voice Minutes (If Any) ★ · Inbound calling · Outbound calling · Outbound Cost
- Cost Per SMS ★ · Cost per Email · Image AI Cost
- Plan ★ `[Enterprise/ Custom; LimeBot; LimeBusiness; LimeMarketer]`
- Products in Scope ★ (MultiSelect, ~60 options incl. Click based bot, AI Bot, GPT Bot, AI Agent, CRM, Broadcasts, Flows, NDR, NPS…)
- Product Type ★ `[Chat BOT; Voice BOT; Helpdesk; Marketing Platform]`
- Product Module `[Broadcast; Campaigns; CRM Integration Add on; CTWA Add on; GPT Add on; Helpdesk; IG BOT Add on; Instagram BOT; Instagram CTD Ads; Instagram RN; NDR BOT; Post Purchase Bot …]`
- Type of Bot ★ `[Agentic Sales; AI Agent; AI Bot; Click Based Bot; GPT Bot; NDR; No Bot]`
- Business Type ★ `[Net New; Existing New; Existing Expansion]`

**Contract & billing**
- Contract Start Date ★ · Contract Renew date ★ · Agreement Signed date · Platform Fee Start Date · billing_start_date
- Contract Link ★ (URL) · Signed Agreement (Text) · First Invoice link
- Chargebee Subscription ID · GST Number
- Billing Status `[Active; On hold; POC completed]` · Billing Notes · No Pending invoices (Boolean)
- Wallet `[Enabled; Not Enabled; On Hold; Rejected; Disabled; Gupshup Direct Billing; Webengage / Infobip Direct Billing; 360D Direct Billing]`
- LC Account ID ★ (Integer)

**Account classification**
- Company Type `[Mid-Market; Enterprise]` · Deal Level `[Mid- Market; Enterprise]` (duplicate concept)
- Nature Of The Account ★ `[Self-Serve with only Email Support; Self- Serve with Call Access; Dedicated CSM Support with WhatsApp Group; Mid-Market; Enterprise; Self Serve]`
- Account Classifier `[Bronze; Silver; Gold; Platinum; Self - Serve]`
- Industry `[Automobile; BFSI; Consumer Durables; Consumer Tech; eCommerce; Hospitality; Real Estate]`
- Employee Size Of Company (Cloned) ★ · Website Traffic Range (Cloned) · HQ City ★ · Brand Website ★
- Website Backend Store ★ `[Shopify; Magento; Custom Backend; Woo Commerce; BigCommerce]`

**Prospect tech stack (competitive intel)**
- Current Automation tool `[Contlo; Bik; BoB; Engati; Bytespeed; Kwikchat; Gupshup; Yellow; Haptik; Karix …]`
- Whatsapp BSP Provider `[ACL; Gupshup Enterprise; Gupshup Self Serve; LC Cloud API; Maytapi; WATI; 360; Netcore; Infobip; Karix; Gupshup; Other]`
- CRM Integration `[Kapture; FreshDesk; Gorgias; Delight Chat; One Direct; Others; Not Applicable]`
- Courier Aggregator `[Shiprocket; Pickrr; Delhivery; Clickpost; EasyEcom; EazySlip; Other]` · Logistics
- 360Dialog disabled? `[Yes; No; Never added]` · Competitor Name

**Sales process**
- Account Executive ★ (Text) · SDR (Select of 12 names) · Primary Decision Maker
- Contact Source (Cloned) `[Paid Ads; Events; Paid Search; Paid Social; Direct Traffic; Other Campaigns; Email/Newsletter; Organic; Social Media; Sheet Allocation (Outbound); Self Generation; Partnerships …]`
- Partner Name (38 partners: 360 Dialog, Adyogi, Appbrew, Clevertap, Clickpost, Easy Ecom, …)
- Meeting Scheduled Date · SQL Date · Second Meeting Done - Enterprise · Close Date ★ · Create Date
- Days spent in: Qualified meeting / Sales Qualified Lead / Ongoing discussion / Commercial discussion / Sales Agreement Sent / Sales Agreement signed (Integers, populated by workflow, presumably)
- Why Closed Lost? ★ `[No Differentiation; Lost To Competitor - Pricing Gap; Lost To Competitor - Product Gap; Budget; Timeline issues; AE/SDR Failure]`
- Deal Score · Client Engagement Level `[Highly/Moderately/Not Engaged]` · Engagement Status `[Active; Deferred; Abandoned]`
- Deal Stage (Select mirror of "Stage (Pipeline)", 27 values), Deal Name, Record ID, Last Activity, Last Modified Date: **HubSpot-import leftovers**

**Onboarding**
- Kickoff Date ★ · Handed to onboarding date · in OB? `[Yes; No]` · Requires OB effort (Boolean) · Onboarding Stage (Text)
- Onb Account Health `[Yellow; Green; Red; Blocked]` · Outcome Plan Summary
- Bot Go Live Date · Campaigns Go Live Date · Activated On Date · Actual duration
- VOICE Adoption ★ (17 states: Agreement Sent … Live, Live - Competitor, Live - Paused…) · VOICE AI Agreement `[Shared; Signed; To be sent]`

**Customer success & churn**
- Health (CSM Pulse) `[Green; Yellow; Red; Healthy; At Risk; Might Churn]` · Health Rating Rationale
- NPS ★ · active status `[active; non-active]`
- Churned deal `[Yes; No]` · Churn Category `[Payment; Business; Onboarding Experience; Low Value; Support Issues; Competition - Product Experience; Competition - Pricing; Corporate Changes; Did not start with LC; Self Serve; Product Issues / Gaps; Netcore Churn]`
- Churn reason description ★ · Churn Communication Date ★ · Churn - last billing date ★ · MIS Churn Date

### 4.2 Contact — 51 custom fields
- **Lead lifecycle:** Lead Stage -Label Dropdown `[Lead; MGL; Prospect; MRL; MQL; SQL; Partnership; TBQ]` · Lead Status Drop Down `[Not Contacted; Attempted Contact; Ongoing; Deferred Contact; Meeting Completed; Qualified Meeting; Disqualified/Not Interested; Meeting Scheduled; Duplicate; SQL; Meeting done with the Company; Partnership Contact …]` · Contact Status (MultiSelect, 20 values) · Outreach Status `[Attempted Contact; WA; Email; Call; Follow up]` · Sales Accepted Lead `[Yes; No]`
- **Dates:** meeting completed date · Qualified meeting date · SQL date · Sales Qualified Date · Sales Qualification Date · Latest Qualified Lead Date · Date entered "SQL (Lifecycle Stage Pipeline)" (the last is HubSpot legacy)
- **Attribution:** Contact Source · Source · Partner Name · SDR · Contact owner (Select of 27 names: a duplicate of the system Owner)
- **Firmographics:** Industry · Employee Size of Company · Website URL · Website Traffic Range (200+ messy options) · Shopify Plan · Plan · Product Type (required) · HQ City · Country/Region · State/Region · Postal Code · Designation · Company size
- **Billing:** Billing Address/City/State/Country/Zip · Chargebee Customer ID · Total number of Invoices Due
- **Email consent:** 4 "Opted out of email: …" flags
- **AI SDR:** Prospecting Agent Total Enrolled Count
- **Legacy:** Record ID · Company Name_hs · Updated by user ID · Last Activity · Last Modified Date
- **Note:** BANT scores (Authority/Need/Budget/Timeline) from the April SOP **are not present** as fields; they were either removed or kept elsewhere.

### 4.3 Company — 40 custom fields
LC Account ID · Chargebee Customer ID · Chargebee Site Name `[limechat; limechat-test]` · Billing Cycle · Brand Website · Company Domain Name · Email · Phone · address fields · Courier Aggregator · CRM Integration · Website Traffic Range · Lifecycle Stage (HubSpot values) · enrichment fields (Year Founded, Employee range, Industry group, LinkedIn, Logo URL, Total Money Raised, Total Revenue, Time Zone, About us, Has been enriched) · several HubSpot-legacy dates.

### 4.4 Activity/Task — 2 custom fields
Source · Last modified at.

---

## 5. Record page layout (deal)

- **Left column:** title, value, close date, owner, stage. Then Company Details and an "About this deal" field panel (the gated fields above).
- **Centre:** stage progress bar, then a unified timeline with filters All / Activities / Notes / Emails / Files / Texts / **Updates** (field-level change history, e.g. "Stage Updated by X: Commercial Discussion → Agreement Sent", "Win Probability 70% → 80%").
- **Right column:** Overview (Created, Last Activity, Last Communication), Contact Details, Participants, Associate Products, Quotes, Tickets, Sequences, Teammates, Files, Documents.

LimeCRM should keep the **Updates timeline**. It's the audit trail people rely on.

---

## 6. Reports & dashboards (must-reproduce metrics)

**Dashboards (shared):** AE Performance (empty), Enterprise SDR Dashboard, Marketing dashboard, Mid Market SDR Dashboard, MRR Dashboard – Enterprise, MRR Dashboard – Mid Market, Onboarding, Renewal Dashboard, Sales Commit Dashboard, Total MRR and Account.

**Reports (87), grouped by the question they answer:**

| Theme | Reports |
|---|---|
| **MRR booked** | Total MRR Closed – Enterprise / Mid Market · MRR + Implementation – Enterprise / Mid Market · Closed revenue by AE's · Deal leaderboard – amount closed by user · Total One-Time Revenue Closed · Mid Market – Implementation fees · MRR – Inbound · MRR Closed – Inbound · Monthly won deals over this year · Revenue by source over time · Closed deal total by source |
| **Forecast & pipeline** | Weekly Forecast – AE Commit – MRR (± Implementation) by Rep · Weekly Forecast – Open Pipeline – MRR (± Implementation) by Rep · commits / commits ent · Pipeline Value (– Enterprise) · Deals value by stage · Deal count by stage · Deals forecast this year |
| **Top of funnel (contact-based)** | MQL'S · MQL'S By Industry · SQL'S · SQL's by Plan · Total Number of SQL's – Ent/MM · SQL's Split by Source – Ent/MM · SQL'S – Outbound – Enterprise · Total Meetings Added – Ent/MM · Meetings Added – Partnerships · MM SDR \| Meetings Done Cohort · MM SDR \| SQL from Meeting Cohort · SQL to Closure Conversion \| Q2 & Q3 2026 · SDR Activity · TouchPoints by SDR · This month so far! · Website Traffic Range |
| **Mix splits** | Split by Plan / Product Type / Source / Business Type / Industry Type / SDR & AEs, each × Enterprise / Mid Market, on both Contact and Deal |
| **Customer book (CS)** | All Active Accounts [MM, Growth & SS] · Mid Market Accounts · Self-Serve Accounts · Total Account per CSM (– Count / MRR / Health wise) · Midmarket – Owner-wise Account & MRR / Deal & MRR · total mrr and account · billing cycle / billing cycle ent |
| **Churn & loss** | Churned Accounts By Reasons / [Count] / Total Count / Total Value, each × CS / OB · Deal lost reasons (×2) · Revenue lost over this year |

Report authors: Javeed (most sales/SDR reports), Kanika (marketing/MQL), Harshith and Bhavya (CS book and churn), Aniket and Saahil (MRR). These are the UAT owners for LimeCRM reporting.

---

## 7. Observations that change the LimeCRM design

1. **Pricing is already a structured rate card**, spread over ~25 fields (platform fee via Monthly Invoice value, per-agent fee, per-bot-session + slabs T0–T6, WA marketing/utility, voice per-minute, SMS, email, image AI, free allowances, implementation fee). In LimeCRM it becomes a proper `rate_card` / `line_items` model, and MRR is computed from it.
2. **The fields Onboarding asked for in July now exist** (LC Account ID, Contract Link, NPS, Kickoff Date, Nature of the Account, Voice fields, Wallet). The problem is enforcement and duplication across clone deals, not missing schema.
3. **Status is unused**: 903 "Handed to Onboarding" and 545 CS "Churned" deals are all status = Open. LimeCRM should derive status from stage type (open / won / lost / churned).
4. **Duplicate concepts to merge:** Company Type vs Deal Level vs Nature Of The Account vs Account Classifier; Product Type vs Products in Scope vs Product Module vs Type of Bot; Owner vs "Contact owner" vs Account Executive (text); Contact Source vs Contact Source (Cloned) vs Source. Also HubSpot leftovers (Deal Stage select, Record ID, *_hs fields, Lifecycle Stage).
5. **Reconnect is a 2,605-deal nurture list**, and 2,260 of those are "New (Untouched)". It's a list, not a pipeline.
6. **Unused modules** (Products, Quotes, Tickets, Goals) and seat-only features: don't build them. Targets live in Notion, so a lightweight Targets table in LimeCRM would make the "vs target" reports possible.
7. **Data anomaly:** Onboarding "Implementation in Progress" shows ₹1.04Cr across 46 deals, almost certainly one or more mis-entered values. Migration validation should flag outliers.
8. **9 Admins on a flat role hierarchy** means broad edit rights. LimeCRM's role model (Sales / OB / CS / Finance / Viewer) plus field-level locks on billing fields is a real control improvement, since LimeCRM is now the billing source of truth.
