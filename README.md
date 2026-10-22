# LimeCRM

LimeChat's in-house CRM, replacing Salesmate. **LimeCRM is the source of truth** for deals, MRR, the active-client list and churn.

- Plan: [docs/PLAN.md](docs/PLAN.md)
- What we're replacing (reverse-engineered Salesmate spec): [docs/salesmate-inventory.md](docs/salesmate-inventory.md)

## Model in one paragraph

**Leads** (contacts with a lead status) are worked by SDRs with BANT scoring. Reaching Qualified Meeting or SQL opens the company's first deal automatically. One **Organization** per customer, with a lifecycle (Prospect → Onboarding → Active → On hold → Churned) and role-based owners (AE, OM, CSM). **Deals** move through the Sales pipeline only. Winning one is the handoff: it opens the organization's **Onboarding** record instead of cloning the deal into another pipeline. **MRR is computed** from deal line items (platform fee, seats, rate card, slabs), never typed. Every stage has a **gate** (required fields, carried forward through later stages) mirroring Salesmate's conditional-required rules, and the same gate applies in the UI and the API. Every change lands in an append-only **events** log, which powers the timelines.

**Reconnect** replaces Salesmate's Reconnect pipeline. A company that isn't buying yet gets a *reconnect on* date and a reason: set them on the company page with the 1, 3 or 6-month presets. **Reconnect** in the sidebar lists these companies, soonest first. On the day, the morning job opens a "Reconnect with …" task for the company's AE, so it shows up in My work and in the AE's digest. After the call, the AE sets the next date or takes the company off the list.

**Bulk edit:** tick rows on Leads or Companies, then change several at once. Each record still goes through its normal update, so the change is audited, webhooks fire, and lead statuses still need their SOP fields. Leads that can't move are named in the result. **CRM hygiene** (Reports) scores each AE and SDR on the same rules the stage gates and the SOP use, with a list of records to fix.

## Run it locally

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 16 on 127.0.0.1:5444
pnpm db:migrate
pnpm db:seed        # stages + gates, dev admin, fictional demo data
pnpm dev            # http://localhost:3000
```

`pnpm dev` runs as `DEV_USER_EMAIL` without signing in. Unset it to use Google sign-in locally (see below).

## Sign-in and roles

Google SSO via Auth.js v5, limited to the **limechat.ai** Google Workspace (verified email + Google's `hd` claim). Only people who already have an **active** row in `users` can sign in; nobody is auto-provisioned, because even read-only access exposes every customer's contract and MRR. Role and `is_active` are re-read from `users` on every request, so deactivating someone locks them out on their next click. Every route requires a session except `/api/v1` (bearer token), `/api/auth/*` and `/signin`.

Set up the Google OAuth client once per environment:

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: User type **Internal** (limits it to the limechat.ai Workspace).
2. **Credentials → Create credentials → OAuth client ID**, type **Web application**. Authorized redirect URI: `https://<host>/api/auth/callback/google` (and `http://localhost:3000/api/auth/callback/google` for local testing).
3. Put the client ID and secret in `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and a random `AUTH_SECRET` (`openssl rand -base64 33`). Behind your own proxy, also set `AUTH_TRUST_HOST=true`.

| Role | Can |
|---|---|
| viewer | Read everything, change nothing |
| sales, onboarding | Edit deals, organizations, onboarding, activities |
| cs | As above, plus mark an organization churned |
| finance | As sales, plus edit pricing line items and contract fields on won deals, and move a deal out of Won |
| admin | Everything |

Won deals are the billing record, so their line items, contract fields (billing cycle, currency, contract start/renewal/link) and Won stage are Finance/Admin only. Rules live in `src/domain/permissions.ts`; server actions return the refusal as a form error.

## Design

LimeCRM uses the **LimeChat Design System V3** ([Figma](https://www.figma.com/design/Ncj0VUMigW7YqlpYcCB12G/LimeChat-Design-System---V3)) on **Mantine v9**, with the same theme as LimeNotes. The two apps should feel like one family.

- **Tokens:** colours, type, spacing, radius and shadows come only from `src/theme/theme.ts`, which uses the same values as LimeNotes' `theme.ts`; keep the two in sync. Don't hard-code hex colours in components; use Mantine props, `var(--mantine-…)` or the extra `--lc-*` tokens in CSS modules.
- **Typeface:** Lato, self-hosted in `src/theme/fonts`.
- **Light and dark:** the scheme is stored in the `lc-color-scheme` cookie and rendered on the server, so there's no bootstrap script.
- **Shell:** `src/components/app-frame.tsx` mirrors LimeNotes' AppFrame: the "LimeCRM / by LimeChat" lockup, a sidebar, a theme toggle and the user menu.
- **Brand assets:** in `public/`.
  - The LimeChat mark is for the header and favicon.
  - The wordmark is for sign-in.
  - Limey is only for empty states and sign-in, with one short plain line.
- **Server components and Mantine:**
  - Use flat exports (`GridCol`, `TableTr`, `TimelineItem`), not `Grid.Col` and friends.
  - Never pass `component={Link}` from a server file; use `AnchorLink` or `ButtonLink` from `src/components/links.tsx`.

## Slack

LimeCRM posts to Slack through its own bot.
- **Deals channel:** deal wins and losses, and handovers to CS.
- **Alerts channel:** churn alerts, and renewal reminders 30, 7 and 1 day out.
- **Client channels:** on a company's first win, it creates `#client-o-<company>`, invites the AE, the onboarding manager and Metric Bot, and records the channel on the company.
- **Morning DMs:** each person gets their overdue and today's tasks and their quiet deals.

Messages go through an outbox (`notifications`): they're queued in the same transaction as the change and sent right after the request. Failures retry with backoff, and admins see everything under **Notifications**. Without a token, messages are recorded as *skipped*, not sent.

Setup:
1. Create the app from [docs/slack-app-manifest.yml](docs/slack-app-manifest.yml): api.slack.com/apps → Create New App → From a manifest. Then **Install to Workspace**.
2. Set these environment variables:
   - `SLACK_BOT_TOKEN`: the Bot User OAuth Token (`xoxb-…`).
   - `SLACK_DEALS_CHANNEL_ID`: the ID of the deals channel (`C…`, from channel details → About).
   - `SLACK_ALERTS_CHANNEL_ID`: the ID of the alerts channel.
   - `SLACK_METRIC_BOT_USER_ID` (optional): Metric Bot's member ID (`U…`), from its profile → ⋯ → Copy member ID.
3. For a **private** channel, also run `/invite @LimeCRM` in it.
4. In dev and staging, set `SLACK_SANDBOX_CHANNEL_ID` to a test channel. Every message then goes there, labelled with where it would have gone: no DMs, and no `#client-o-…` channels get created. Leave it empty in production.
5. Run `pnpm slack:check` to check the token, scopes and channels and post a test message (`--no-post` to only check, `--samples` to post one of each message type).

Messages use the LimeChat palette for the bar down their left edge: lime for wins and digests, green for handovers, red for churn, grey for losses. For the bot's avatar, upload `public/brand/limecrm-slack-icon.png` under the app's **Basic Information → Display Information**.

## Scheduled jobs

[vercel.json](vercel.json) runs `/api/cron/dispatch` every 5 minutes (sends and retries) and `/api/cron/daily` at 09:00 IST on weekdays (renewal reminders and morning digests). Both need `Authorization: Bearer $CRON_SECRET`; Vercel sends it automatically when `CRON_SECRET` is set. Elsewhere, call them from any scheduler with that header. Re-running is safe, because each message has a dedupe key.

## Scripts

| | |
|---|---|
| `pnpm test` | Unit tests (MRR maths, stage gates, permissions) |
| `pnpm typecheck` / `pnpm lint` | |
| `pnpm db:generate --name <change>` | New migration after editing `src/db/schema.ts` |
| `pnpm db:studio` | Browse the database |
| `pnpm migrate:extract-mcp` | Interim Salesmate snapshot through the local Salesmate MCP (open deals only, no custom fields), then `migrate:transform --snapshot …` and `migrate:load --replace` |

## API (v1) and MCP

Internal apps (AccountPulse, the CS dashboard, the collections agent, the AI SDR) and Claude each get **their own API key**. An admin creates them under **Settings → API keys** (`/settings/api-keys`):

- **Acts as** a LimeCRM user. Every call runs as that user, with the same role rules and stage gates as the UI: a viewer's key can't write, and only a Finance or Admin key can take a deal out of Won. Deactivating the user stops their keys.
- **Access** is read only, or read and write (`write` includes `read`).
- The key (`lcrm_…`) is shown **once**. LimeCRM stores only its sha256, the first few characters (so you can tell keys apart) and when it was last used. A lost key can't be recovered: revoke it and create another.

Send it as `Authorization: Bearer lcrm_…`. Errors are `{ error }` with a 401 (no, unknown or revoked key), 403 (scope or role), 404, 400 or 422 (`{ error, missing: [{ key, label }] }` when a stage gate or lead requirement isn't met). Successes are `{ data }`.

The old shared `LIMECRM_API_TOKEN` still works while it's set, so existing consumers keep running until they move to a key. It can read everything; its writes must name an active user in `actorEmail`. Unset it once nothing uses it. The MCP server doesn't accept it.

### Money

`mrr` is **monthly recurring revenue in the deal's `currency`** (INR for almost every deal; USD deals aren't converted). It's computed from the deal's line items and normalized to a month (an annual ₹1,20,000 item is ₹10,000 MRR); it can't be set through the API. One-time charges (implementation fees) are in `oneTimeFee`, never in MRR. An organization's `contractedMrr` is the MRR of its won deals whose contract hasn't ended, and 0 once churned. An open deal's MRR is pipeline, not revenue. Amounts are plain rupees, not lakhs.

### REST

| Method | Path | Scope | |
|---|---|---|---|
| GET | `/api/v1/organizations?lifecycle=active&q=acme` | read | Customer book with contracted MRR and owners. `q` matches name, website or a LimeChat account id |
| GET | `/api/v1/organizations/:id` | read | Organization with deals, contacts, onboardings |
| GET | `/api/v1/deals?stage=&status=&owner=&q=&orgId=&limit=100&offset=0` | read | Deals, most recently updated first, with `total`. `stage` is a Sales stage key, `status` is open/won/lost, `owner` is a user id, an email or `me` |
| GET | `/api/v1/deals/:id` | read | Deal with organization, owner, line items and `stages`: each stage with the fields still `missing` to move there |
| GET | `/api/v1/deals/:id/line-items` | read | Pricing, each item with its `monthlyValue`, plus the deal's `mrr`, `oneTimeFee` and `currency` |
| POST | `/api/v1/deals/:id/transition` | write | `{ stage }`. 422 with `missing` if the gate isn't met |
| GET | `/api/v1/leads?status=&owner=&sdr=&q=` | read | Leads (up to 100) with BANT total, plus `counts` per status |
| GET | `/api/v1/leads/:id` | read | Lead with company and the company's deals |
| POST | `/api/v1/leads` | write | `{ name, companyName, email? or phone?, designation?, website?, linkedinUrl?, source?, productInterest?, sdr?, owner?, message? }`. For the website demo form and the AI SDR. 201 `{ leadId, orgId, created: true }`. If that email is already in LimeCRM, 200 with `created: false`: nothing is duplicated and `message` is logged on the existing person. `source`, `productInterest` and the other picklist fields must be values from Settings → Fields (matched loosely: "paid ads" → "Paid Ads"); anything else is a 422 that lists the allowed values. `source` defaults to Inbound |
| POST | `/api/v1/leads/:id/status` | write | `{ status }`. 422 with `missing`; Qualified Meeting / SQL returns the `dealId` it opened or linked |
| POST | `/api/v1/activities` | write | `{ type, subject, body?, orgId?, dealId?, contactId?, dueAt?, completedAt? }`. Logged as the key's user; 201 |

```bash
curl -s -H "Authorization: Bearer $LIMECRM_KEY" "http://localhost:3000/api/v1/deals?status=won&owner=me"
```

### MCP server

`/api/v1/mcp` is a stateless [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http) MCP server (official TypeScript SDK) that replaces the Salesmate MCP. It takes the same API keys. Tools: `search_deals`, `get_deal`, `update_deal_stage` (returns the `missing` gate fields when it refuses), `search_organizations`, `get_organization`, `search_leads`, `get_lead`, `create_lead`, `set_lead_status`, `log_activity` and `list_users`. The write tools need a read-and-write key.

For Claude Code, create a key for yourself and add this `.mcp.json` to your project (or `~/.claude.json`), with the key in your shell environment rather than in the file:

```json
{
  "mcpServers": {
    "limecrm": {
      "type": "http",
      "url": "https://<limecrm-host>/api/v1/mcp",
      "headers": { "Authorization": "Bearer ${LIMECRM_API_KEY}" }
    }
  }
}
```

Or from the command line: `claude mcp add --transport http limecrm https://<limecrm-host>/api/v1/mcp --header "Authorization: Bearer $LIMECRM_API_KEY"`.

To try it with curl:

```bash
curl -s http://localhost:3000/api/v1/mcp \
  -H "Authorization: Bearer $LIMECRM_API_KEY" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_deals","arguments":{"status":"won"}}}'
```

### Webhooks

Admins add endpoints under **Settings → Webhooks** (`/settings/webhooks`), so internal apps hear about changes as they happen instead of polling. Each endpoint picks its events, or all of them:

`deal.created` · `deal.updated` · `deal.stage_changed` (includes won and lost) · `deal.pricing_changed` · `organization.created` · `organization.updated` · `organization.lifecycle_changed` · `organization.churned` · `onboarding.created` · `onboarding.updated` · `onboarding.stage_changed` · `lead.created` · `lead.updated` · `lead.status_changed`

LimeCRM POSTs JSON like this:

```json
{
  "id": "6f1c…",
  "event": "deal.stage_changed",
  "occurredAt": "2026-10-22T10:15:00.000Z",
  "data": { "entityType": "deal", "id": "…", "orgId": "…", "actorId": "…", "changes": { "from": "Invoice Raised", "to": "Won · Handed over" } },
  "links": { "api": "https://<host>/api/v1/deals/…", "app": "https://<host>/deals/…" }
}
```

The payload is deliberately thin. Fetch the full record from `links.api` with the app's API key.

- **Signature.** `X-LimeCRM-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is the HMAC-SHA256 of `<t>.<raw body>` keyed with the endpoint's secret. The secret is shown once, when the endpoint is created. Reject a request if the signature doesn't match or `t` is more than 5 minutes old. `verifySignature` in `src/domain/webhooks.ts` is the reference implementation.
- **Delivery.** Each change is queued in the same transaction as the change itself, and sent right after the request.
- **Retries.** A non-2xx answer or a timeout (10 seconds) is retried with backoff for about 5 hours by the dispatch cron. A 4xx other than 408 or 429 isn't retried.
- **Duplicates.** The same delivery can arrive twice, so de-duplicate on `id`.
- **Pausing.** Pausing an endpoint skips its deliveries. **Send test** sends a `ping`.
- **Imports.** Imports (Salesmate migration) don't fire webhooks.

## Layout

```
src/db/          schema, client, seed
src/domain/      pure logic: MRR maths, gates, stage config (unit-tested)
src/server/      DB-bound services: transitions (handoffs), mutations, queries, auth
src/app/         Next.js routes, server actions, /api/v1
src/components/  UI
```
