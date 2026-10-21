/**
 * Check the Slack setup in .env and post one test message to each configured channel.
 *
 *   pnpm slack:check            # token, scopes, channels, Metric Bot; then post test messages
 *   pnpm slack:check --no-post  # checks only
 *   pnpm slack:check --samples  # also post one of each notification (fictional data) to the
 *                               # sandbox channel, or the deals channel when there's no sandbox
 *
 * Prints what's wrong in plain words; never prints the token.
 */
import "dotenv/config";
import {
  churnedMessage,
  clientChannelIntro,
  dailyDigestMessage,
  dealLostMessage,
  dealWonMessage,
  handedToCsMessage,
  renewalDueMessage,
  type SlackMessage,
} from "@/domain/notify";
import { postMessage } from "@/server/slack";

const REQUIRED = ["chat:write", "chat:write.public", "channels:read", "channels:manage", "users:read", "users:read.email"];

type SlackReply = {
  ok: boolean;
  error?: string;
  user?: string;
  team?: string;
  channel?: { name: string; is_private: boolean };
  // users.info returns `user` as an object; auth.test returns it as a name.
} & Record<string, unknown>;

// Read methods (conversations.info, users.info) only take form-encoded arguments, not JSON.
async function api(method: string, args: Record<string, string> = {}) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    body: new URLSearchParams(args),
  });
  return { json: (await res.json()) as SlackReply, scopes: res.headers.get("x-oauth-scopes") ?? "" };
}

let failed = false;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => {
  failed = true;
  console.log(`  ✗ ${m}`);
};

async function main() {
  const post = !process.argv.includes("--no-post");
  if (!process.env.SLACK_BOT_TOKEN?.startsWith("xoxb-")) return bad("SLACK_BOT_TOKEN is missing or isn't a bot token (xoxb-…)");

  const auth = await api("auth.test");
  if (!auth.json.ok) return bad(`token rejected: ${auth.json.error}`);
  ok(`token works: bot @${auth.json.user} in ${auth.json.team}`);
  const granted = auth.scopes.split(",").map((s) => s.trim());
  const missing = REQUIRED.filter((s) => !granted.includes(s));
  if (missing.length) bad(`missing scopes: ${missing.join(", ")} (add them in the app's OAuth & Permissions, then reinstall)`);
  else ok("all scopes granted");

  for (const key of ["SLACK_DEALS_CHANNEL_ID", "SLACK_ALERTS_CHANNEL_ID"] as const) {
    const id = process.env[key];
    if (!id) {
      bad(`${key} is not set`);
      continue;
    }
    const info = await api("conversations.info", { channel: id });
    if (!info.json.ok) {
      bad(`${key}: ${info.json.error === "channel_not_found" ? "channel not found (wrong ID, or a private channel the bot isn't in: /invite @LimeCRM)" : info.json.error}`);
      continue;
    }
    const ch = info.json.channel!;
    ok(`${key} → #${ch.name}${ch.is_private ? " (private)" : ""}`);
    if (!post) continue;
    try {
      await postMessage(id, "LimeCRM is connected", [
        { type: "section", text: { type: "mrkdwn", text: `:white_check_mark: *LimeCRM is connected.* ${key === "SLACK_DEALS_CHANNEL_ID" ? "Deal wins, losses and handovers to CS" : "Churn alerts and renewal reminders"} will post here.` } },
        { type: "context", elements: [{ type: "mrkdwn", text: "Test message from `pnpm slack:check`" }] },
      ]);
      ok(`posted a test message in #${ch.name}`);
    } catch (e) {
      bad(`couldn't post in #${ch.name}: ${(e as Error).message}${ch.is_private ? " (invite the bot: /invite @LimeCRM)" : ""}`);
    }
  }

  const metric = process.env.SLACK_METRIC_BOT_USER_ID;
  if (!metric) console.log("  · SLACK_METRIC_BOT_USER_ID not set: client channels won't get Metric Bot");
  else {
    const u = await api("users.info", { user: metric });
    const user = u.json.user as unknown as { name: string; real_name?: string };
    if (u.json.ok) ok(`Metric Bot → ${user.real_name || user.name}`);
    else bad(`SLACK_METRIC_BOT_USER_ID: ${u.json.error}`);
  }
}

/** One of each message, built by the same functions the outbox uses, about a fictional company. */
function samples(app: string): SlackMessage[] {
  const deal = { url: `${app}/deals`, title: "Monsoon Coffee - Voice BOT", company: "Monsoon Coffee", mrr: 45000, oneTimeFee: 25000, owner: "Asha Rao", sdr: "Kabir Shah" };
  const org = { url: `${app}/companies`, company: "Monsoon Coffee", mrr: 45000, csm: "Meera Iyer", om: "Dev Patel" };
  const item = (label: string, detail: string) => ({ label, url: `${app}/work`, detail });
  return [
    dealWonMessage({ ...deal, products: ["Voice BOT", "Chat"] }),
    dealLostMessage({ ...deal, stage: "Closed Lost", lostReason: "Went with in-house build" }),
    handedToCsMessage({ ...org, nps: 9 }),
    churnedMessage({ ...org, category: "Product gaps", reason: "Needed Instagram DMs", lastBillingDate: "2026-11-30" }),
    renewalDueMessage({ url: `${app}/deals`, company: "Monsoon Coffee", deal: deal.title, renewalDate: "2026-10-29", daysLeft: 7, mrr: 45000, owner: "Asha Rao" }),
    clientChannelIntro({ company: "Monsoon Coffee", url: org.url, ae: "Asha Rao", om: "Dev Patel" }),
    dailyDigestMessage({
      name: "Asha Rao",
      overdue: [item("Send revised quote", "Monsoon Coffee · due yesterday")],
      today: [item("Kickoff call", "Northwind Finserv · 4:00 pm")],
      stale: [item("Brady Corp - Chat", "No touch in 18 days")],
      workUrl: `${app}/work`,
    })!,
  ];
}

async function postSamples() {
  const channel = process.env.SLACK_SANDBOX_CHANNEL_ID || process.env.SLACK_DEALS_CHANNEL_ID;
  if (!channel) return bad("--samples needs SLACK_SANDBOX_CHANNEL_ID or SLACK_DEALS_CHANNEL_ID");
  for (const m of samples(process.env.APP_URL || "http://localhost:3000")) {
    const label = { type: "context", elements: [{ type: "mrkdwn", text: ":test_tube: Sample · fictional data" }] };
    await postMessage(channel, m.text, [label, ...m.blocks], m.color);
  }
  ok("posted one sample of each notification");
}

main()
  .then(() => (process.argv.includes("--samples") && !failed ? postSamples() : undefined))
  .then(() => process.exit(failed ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
