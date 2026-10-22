# HubSpot features Salesmate is missing, and how LimeCRM should cover them

The team used HubSpot before Salesmate. This note covers the four gaps raised on 2026-10-22: what HubSpot does, what Salesmate does today, and what LimeCRM should build. It also lists what each build needs from us.

## 1. Contacts created automatically from sales email

**HubSpot**
- Connects each rep's Gmail or Outlook inbox. Emails between a rep and outside people are logged on the contact's timeline automatically.
- A recipient who isn't in the CRM yet becomes a new contact. HubSpot matches them to a company by email domain, or creates that company too.
- Admins keep a "never log" list of domains and addresses (personal mail, vendors, internal).
- Without the inbox connection, emails can be logged by BCC or forward to a per-account address.
- Open and click tracking is optional.

**Salesmate today:** emails are logged only where the rep acts in Salesmate, so contacts depend on manual entry. That's why so many deals have no contact. 0 of the 5,328 deals the MCP returned had contact details.

**LimeCRM plan**
- **Gmail sync** through the Google Workspace API, read-only (headers and snippet, not attachments). It reads the mail of LimeCRM users on the sales, onboarding and CS teams, every few minutes.
- For each email with an outside address:
  - Find the contact by email.
  - If there isn't one, create the contact from the display name, and find or create the company by domain.
  - Free-mail domains (gmail.com and similar) get a contact but no company. Internal domains and the never-log list are skipped.
  - Log an "Email" activity on the contact, the company and the company's open deal.
  - This counts as a "touch" for stale-deal and hygiene checks.
- **Privacy:** only work mail of LimeCRM users is read. Each person can see and pause their own sync. The body is stored only as a short snippet. Admins manage the never-log list.
- **Fallback with no Workspace admin access:** a BCC address (for example `log@crm.limechat.ai`) through an inbound-mail service.

**Needs:** a Google Workspace admin to approve one of these:
- (a) a service account with domain-wide delegation for `gmail.readonly` (recommended: no per-person setup), or
- (b) each user connects their Gmail once.

## 2. Granular reporting and dashboards

**HubSpot**
- **Custom report builder:** pick an object (or two, joined), filter, group, and measure.
- **Funnel reports:** across lifecycle stages (lead → MQL → SQL → opportunity → customer), with conversion rate and time between each step. Filterable by owner, source and date cohort.
- **Dashboards:** a set of saved reports, shared with a team and emailed on a schedule.
- **Goals:** quotas per rep.

**Salesmate today:** fixed reports. A cross-stage conversion like "SQL to closed won, by SDR and month" can't be built, which is why it's done in sheets or Metabase.

**LimeCRM plan**
1. **Funnel report, first:** Lead → Meeting scheduled → Meeting completed → Qualified meeting → SQL → Deal won.
   - For each step: count, conversion from the previous step and from the top, and median days.
   - Cut by SDR, AE, source, segment and product.
   - Cohort by the month the lead was created ("of September's leads, how many became SQLs?") or by the month each step happened.
   - LimeCRM already stores the dates this needs (`meeting_scheduled_at`, `meeting_completed_at`, `qualified_at`, `sql_at`, deal `closed_at`), so it's exact, not reconstructed.
2. **Report builder:**
   - Objects: deals, companies, leads, activities.
   - Filters: any standard field (see §3).
   - Group by one or two fields; measure count, sum or average of MRR, or a conversion between two dates.
   - Show as a table or a bar or line chart.
   - Save, share, and add to a dashboard.
3. **Dashboards:** saved reports in a grid, per team (Sales, SDR, OB, CS, Leadership), with a weekly Slack or email digest of each.
4. **Targets:** monthly MRR and SQL targets per person, taken from the Sales Plan (Kopal ₹1.5L, Malavika ₹1.8L…). Attainment shows on reports and on My work.

**Needs:** nothing external. Targets need someone in Sales to own the numbers each month.

## 3. Field standardisation

**HubSpot**
- **Properties settings:** every field has a type (dropdown, multi-select, number, date, single-line text, and so on), a group, a description, and fixed options for dropdowns.
- **Validation:** format rules (email, phone, URL), number ranges, and unique values (for example an account ID).
- **Required fields:** per pipeline stage, and on forms.
- **Data quality tools:** duplicate detection and merge, formatting fixes, unused and empty property reports, and property history.

**Salesmate today:** 116 deal custom fields, many free text where they should be picklists. Source, industry, products, lost reason and LC Account ID are typed in many ways. Required fields are enforced only by the SOP and the hygiene bonus.

**LimeCRM plan**
1. **Field registry (Settings → Fields):** every field on deals, companies and leads, with its type, group, help text and allowed values.
   - Admins can add, rename, reorder and retire options. Values in use are never deleted silently: a retired option is mapped to a new one.
   - Stage gates (already built) appear on the same page.
2. **Managed picklists** for the fields people type inconsistently today: lead source, industry, products, plan, lost reason, churn reason, partner name and website traffic band.
   - Forms, the API and bulk edit only accept listed values.
   - The API answers with the allowed values when it refuses one.
3. **Normalisation on save:**
   - website → bare domain; email → lower case; phone → E.164 (+91…)
   - company name trimmed and title-cased where it's all caps
   - LC Account IDs → numbers, unique across companies
4. **Data quality page:**
   - Duplicate companies (same domain, or near-identical names) and duplicate contacts (same email), with a merge action.
   - Values outside the picklist, with a "map to" bulk fix.
   - Required fields missing per stage. This feeds the hygiene report.
5. **Migration:** Salesmate's messy values get a reviewed mapping table (for example "Paid ads", "paid-ads" and "PPC" all become "Paid Ads"). After import, every value is standard.

**Needs:** Sales Ops (Kanika or Javeed) to sign off the picklist values once. The current values and their counts come from the extract.

## 4. Email campaigns

**HubSpot**
- **Marketing email:**
  - A drag-and-drop editor with a brand kit and templates, and personalisation tokens.
  - Lists, static or "active" (they update from filters).
  - A/B tests, scheduling and send-time optimisation.
  - Subscription types, so recipients choose what they get; one-click unsubscribe and a suppression list.
  - Bounce and spam handling, plus analytics: delivered, opens, clicks, click map, unsubscribes and replies.
- **Sequences (sales):** a series of 1:1 emails sent from the rep's own inbox, with task steps in between. A prospect leaves the sequence automatically when they reply or book a meeting.
- **Workflows:** automated nurtures triggered by field changes.

**Salesmate today:** campaign setup is hard and lists are clumsy, so campaigns rarely go out.

**LimeCRM plan**
1. **Lists:**
   - "Active" lists defined by the same filters as reports (for example: leads, segment Mid-Market, status Deferred, industry D2C, reconnect due this month).
   - Static lists from a CSV or a selection (bulk edit already has selection).
2. **Templates** in LimeChat branding: a block editor (heading, text, button, image, divider, footer) with tokens (`{{first_name}}`, `{{company}}`, `{{ae_name}}`). Every template carries the company address and unsubscribe footer.
3. **Campaigns:** pick a list and a template, set the sender (a person or "LimeChat"), preview, send a test, then schedule or send.
   - Sending throttles, and skips anyone unsubscribed, bounced or marked as spam.
   - Per campaign: delivered, opened, clicked, replied, unsubscribed, bounced.
   - Opens and clicks are logged on each contact's timeline.
4. **Subscriptions:** each contact has subscription types (Product updates, Webinars, Offers), plus a hosted preference page and one-click unsubscribe headers. These are required by Gmail and Yahoo for bulk senders.
5. **Sequences:**
   - These are after Gmail sync (§1), because they send from the rep's own Gmail and stop on reply.
   - Steps: email, wait, task.
   - A prospect leaves on reply, on a meeting booked, or when their lead status changes.
6. **Nurture automations:**
   - These come later, built on the webhooks and daily jobs that already exist.
   - Example: "when a lead goes Deferred, add them to the Reconnect nurture list".

**Needs**
- **A sending provider:** Amazon SES (cheapest at volume), SendGrid or Postmark.
- **A sending subdomain** (for example `mail.limechat.ai`) with SPF, DKIM and DMARC records added by whoever manages DNS. This keeps campaign reputation separate from everyone's day-to-day mail.
- **Gmail send permission** for sequences (from §1).

## Also worth taking from HubSpot

These are smaller, and most build on the work above:
- Meeting booking links that create the meeting and the lead.
- Email templates and snippets for reps.
- Lead scoring from fit and engagement, alongside BANT.
- Website forms → leads (the lead API exists; a hosted form and an embed are small).
- Duplicate merge (covered in §3).

## Suggested order

| Step | What | Blocked on |
|---|---|---|
| Now | Full Salesmate migration with the API key (custom fields, contacts, activities, real dates) | — |
| Now | §3 field registry, picklists, normalisation and data quality; the migration maps values to them | Picklist sign-off (can start with proposed values) |
| Now | §2 funnel report, then the report builder and dashboards | — |
| Next | §1 Gmail sync and contact auto-creation | Google Workspace admin decision |
| Then | §4 lists, templates, campaigns, subscriptions; then sequences | Sending provider and DNS; Gmail send permission |
