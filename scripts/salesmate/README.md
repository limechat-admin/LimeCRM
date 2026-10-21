# Salesmate → LimeCRM migration

Phase 0/3 tooling for [docs/PLAN.md §5](../../docs/PLAN.md). Three steps, each rerunnable:

```bash
pnpm migrate:extract                 # raw JSON snapshot → data/salesmate/<timestamp>/   (gitignored)
pnpm migrate:transform               # snapshot → out/plan.json + review.csv + report-preview.md
pnpm migrate:load --dry-run          # load into the LOCAL dev DB in a transaction, report, roll back
pnpm migrate:load --replace          # same, committed (replacing any earlier import)
```

All three default to the latest snapshot; pass `--snapshot data/salesmate/<ts>` to pick one.

## Extract

Needs `SALESMATE_ACCESS_TOKEN` in `.env`. Use the **rotated** token. The old one in Notion ("Salesmate CRM: API Patterns…") is leaked, so never use it or paste the new one anywhere else.

- Lists every deal, contact, company and activity with `POST /apis/<module>/v4/search?rows=250&from=N`. The search is unfiltered because server-side filters don't work, it's sorted by id, and paging stops on a short page because `totalRows` is unreliable.
- Then `GET /apis/<module>/v4/{id}` for **every deal** and for the **contacts and companies those deals reference** (custom fields only come back on the detail call). Activities are list-only.
- Probes for a users endpoint and field-metadata endpoints and saves whichever answer to `meta/`.
- Polite: ~3 req/s by default (`--rps`, `--concurrency`), with backoff on 429/5xx. It slows itself down after a 429.
- Resumable: each page and record is its own file, written atomically. `--resume` continues the latest unfinished snapshot, and failed detail fetches are retried.
- `--limit 300` gives a quick smoke test. `--only deals,companies` runs a subset.

## Transform

`out/` inside the snapshot:

| File | What |
|---|---|
| `plan.json` | LimeCRM rows (ids pre-assigned, users by email) for the loader |
| `review.csv` | **Everything a human should check**: severity `review` first, then `info`, with Salesmate links |
| `groups.csv` | Every collapsed sale: Sales + OB + CS deal ids, confidence, MRR and its source |
| `custom-fields.csv` | Census of every custom-field key (fill rate, samples, what we mapped it to) |
| `reconnect.csv` | Reconnect-pipeline deals (not migrated as deals, see gaps) |
| `report-preview.md` | Reconciliation computed in memory |

### Rules

**Clone collapse** ([collapse.ts](collapse.ts)). OB clones are matched to Sales deals, then CS clones are matched to the resulting groups. Scoring: same normalized title +50 (fuzzy +35/+20), same primary contact +25, same company +20, different contact or company −20, clone created before its anchor −10, same Value +5. Matching is greedy and best-first, with one clone per pipeline per sale. Confidence is high ≥ 80, medium ≥ 55, and low otherwise. A match is also **low** when another sale fits within 10 points, and both sides go to review as a possible duplicate Sales deal. Unclaimed OB/CS clones become their own sale (`no_sales_deal`), which is normal for customers that predate Salesmate.

**Organizations.** Sales are unioned when they share a Salesmate company (on the deal or via its contact), an LC Account ID, or a normalized company name. A sale with no company falls back to a name taken from the title: `(Pepe jeans) GOAT Brand Labs - Marketing - Upsell` → `goat brand labs`. A merge of more than one Salesmate company is flagged `org_merge`.

**Stages** ([mapping.ts](mapping.ts)):
- Sales: New, Contacted and Qualified Meetings → `qualified_meeting`. In Negotiation → `commercial_discussion`. Handed to Onboarding and Handed to CS → `won`. Closed Lost → `lost`. Sales Churn → `never_paid`. A sale with OB/CS clones is `won` whatever its Sales stage.
- Onboarding: maps 1:1 onto LimeCRM's onboarding stages. On Hold - Billing and Billing - POC completed → `on_hold_billing`. OB Churned → `on_hold_billing`, completed, with a note. If a CS clone exists, the onboarding is completed even when the OB stage lagged.
- **Lifecycle** of an org comes from its best sale, in the order active > on_hold > onboarding > churned > prospect:
  - CS Active Deals or Renewal Deal Present → active. Billing on Hold → on_hold. Churned → churned.
  - CS "All deals" → active, flagged.
  - Otherwise the OB stage decides.
  - A Sales "Handed to Onboarding" deal with no OB/CS clone becomes onboarding if it closed within 120 days. If older, it is treated as stale: the org is churned with an explicit "status unknown" reason, the deal gets `ended_at`, and it's flagged `won_without_handoff`.
- A churned sale inside an active org gets `ended_at`, so it drops out of contracted MRR.

**MRR and line items.** MRR comes from the CS clone's Value (CSMs keep it current), then the Sales Value, then the OB Value, then Monthly Invoice value (INR only). It becomes a `platform_fee` line item, and `deals.mrr` is computed with `dealTotals` from `src/domain/mrr.ts`. The rest of the rate card becomes usage line items with quantity 0, so it is preserved without inventing committed MRR:
- per-agent fee + free agents → `agent_seat`
- bot session + T0–T6 slabs (as tiers) + free sessions → `bot_session`
- WA marketing / utility, SMS, email, image AI, inbound calling
- per-minute + free minutes → `voice_minute`
- outbound → `outbound_calling`

Implementation Fees → `implementation_fee` (one-time).

**Outliers** (`review`):
- any member deal or computed MRR above ₹5L/mo
- Value vs Monthly Invoice value off by more than max(₹1k, 10%)
- active with ₹0 MRR
- overlapping onboardings in one org (LimeCRM allows one open per org; the newest is kept)
- unmapped stages
- users without an email (created as `salesmate-user-<id>@salesmate.invalid`)

USD billing, Sales→CS Value changes and segment disagreements are `info`.

**Contacts.** Deal primary contacts are loaded, plus any contacts on a migrated company.
- Lead status maps to the `LEAD_STATUSES` keys in `src/domain/leads.ts`. "Meeting done with the Company" → `meeting_completed`. "Partnership Contact" → `ongoing` with lead stage `partnership`. Unknown statuses load empty and are flagged `unmapped_lead_status`.
- Lead stage maps to lead / mgl / mql / sql / partnership; MRL, TBQ and Prospect → `lead`.
- Product Type → `product_interest`. Partner Name → `partner_name`. The meeting-scheduled, meeting-completed, qualified-meeting and SQL dates fill the matching `*_at` columns.
- Website Traffic Range → `organizations.website_traffic_range`.

**Custom fields** ([fields.ts](fields.ts)) are resolved by label from the field-metadata snapshot. The keys decoded in PLAN §2.3 are pinned as a fallback. If the transform prints unresolved fields, find the key in `custom-fields.csv` and pin it in `fields.ts`.

Every row keeps its Salesmate ids: `deals.salesmate_deal_ids` holds all clones, plus `organizations.salesmate_company_id` and `contacts.salesmate_contact_id`. The full provenance (all company ids, group key, confidence, MRR source) is on each record's `created` event, with `data.via = "salesmate_import"`. `--replace` and `--purge` use that marker to find earlier imports.

## Load

Only targets a localhost `DATABASE_URL`. It upserts stages (same as the seed) and inserts missing users without touching existing ones. It bulk-inserts everything, writes `created` and `stage_changed` events dated from Salesmate, and then runs the app's own `recomputeOrg` for contracted MRR.

The report (`out/reconciliation.md`) compares LimeCRM's active orgs and contracted MRR to Salesmate's CS "Active Deals" (the snapshot, plus the 2026-10-20 UI reference of 280 deals / ₹65.7L), broken down by segment and by CSM. It also lists the buckets the difference comes from and the largest org-level gaps.

## Schema gaps (not changed here; proposals for `src/db/schema.ts`)

1. **`organizations.salesmate_company_id` is a single int.** Merged orgs (EverQ/Puresta-style duplicates) have several. Proposal: `salesmate_company_ids integer[]`. For now, extra ids live in the import event.
2. **No Salesmate id on `onboardings`, `activities`, `users`.** Proposal: `onboardings.salesmate_deal_id`, `activities.salesmate_activity_id` (also needed for an idempotent nightly shadow sync), and `users.salesmate_user_id`.
3. **No nurture/reconnect field.** PLAN §4.1 says Reconnect becomes `reconnect_on` on the org/contact. Until that exists, the 2,605 Reconnect deals are exported to `reconnect.csv`, not loaded.
4. **No terminal "cancelled/churned" onboarding stage.** "Churned during onboarding" is stored as `on_hold_billing` + `completed_at` + a note. Proposal: an onboarding stage `cancelled` with kind `lost`.
5. **Currency.** `deals.currency` implies MRR in that currency, but `organizations.contracted_mrr` sums across deals. USD-billed deals are loaded as INR, from Salesmate's INR Value. Proposal: line items in billing currency plus a stored INR-normalized MRR (or an FX table).
6. **Committed seat quantities don't exist in Salesmate.** Agent seats are imported with quantity 0, and MRR sits on the platform-fee line. Once real quantities are entered, the platform fee must be reduced or MRR double-counts.
7. **Fields with no column yet:** Chargebee Subscription ID (needed for the Phase 3 billed-vs-contracted recon), Account Classifier tier (Bronze…Platinum), Wallet, Billing Status, GST Number, Health Rating Rationale (per org: partly `health_note`), Days-in-stage counters.
8. **Pre-qualification stages.** New/Contacted have no LimeCRM deal stage (leads are contacts). Those deals land in `qualified_meeting`.
