/**
 * Minimal Slack Web API client for the LimeCRM bot. Needs SLACK_BOT_TOKEN (xoxb-…) with scopes:
 * chat:write, chat:write.public, channels:read, channels:manage, users:read, users:read.email.
 * See README "Slack".
 */

export const slackConfigured = () => !!process.env.SLACK_BOT_TOKEN;

export class SlackError extends Error {
  constructor(
    public method: string,
    public code: string,
  ) {
    super(`Slack ${method}: ${code}`);
  }
}

async function call<T = Record<string, unknown>>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new SlackError(method, "not_configured");
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new SlackError(method, "ratelimited");
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new SlackError(method, json.error ?? `http_${res.status}`);
  return json;
}

/** Post a message. With `color`, the blocks go in an attachment so Slack draws the brand-coloured bar. */
export async function postMessage(channel: string, text: string, blocks: unknown[], color?: string) {
  const content = color ? { attachments: [{ color, blocks, fallback: text }] } : { blocks };
  return call<{ ts: string; channel: string }>("chat.postMessage", { channel, text, ...content, unfurl_links: false, unfurl_media: false });
}

/**
 * Sandbox mode (dev and staging): with SLACK_SANDBOX_CHANNEL_ID set, every message goes to that one
 * channel, DMs and client channels included, labelled with where it would have gone. Nobody gets
 * DMed and no #client-o channel is created.
 */
export const sandboxChannel = () => process.env.SLACK_SANDBOX_CHANNEL_ID || null;

const userIdCache = new Map<string, string | null>();

/** Slack user id for a work email, or null when they aren't in the workspace. */
export async function userIdByEmail(email: string): Promise<string | null> {
  const key = email.toLowerCase();
  if (userIdCache.has(key)) return userIdCache.get(key)!;
  try {
    const res = await call<{ user: { id: string } }>("users.lookupByEmail", { email: key });
    userIdCache.set(key, res.user.id);
    return res.user.id;
  } catch (e) {
    if (e instanceof SlackError && e.code === "users_not_found") {
      userIdCache.set(key, null);
      return null;
    }
    throw e;
  }
}

/** Create a public channel, or reuse an existing one with the same name. Returns its id and name. */
export async function ensurePublicChannel(name: string): Promise<{ id: string; name: string; created: boolean }> {
  try {
    const res = await call<{ channel: { id: string; name: string } }>("conversations.create", { name, is_private: false });
    return { ...res.channel, created: true };
  } catch (e) {
    if (!(e instanceof SlackError) || e.code !== "name_taken") throw e;
  }
  // Name taken: find it (first few pages of public channels is plenty for an exact name match).
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await call<{ channels: { id: string; name: string }[]; response_metadata?: { next_cursor?: string } }>("conversations.list", {
      types: "public_channel",
      exclude_archived: true,
      limit: 1000,
      cursor,
    });
    const hit = res.channels.find((c) => c.name === name);
    if (hit) return { ...hit, created: false };
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  throw new SlackError("conversations.create", "name_taken_but_not_found");
}

/** Invite users to a channel, ignoring people who are already in it. */
export async function invite(channel: string, userIds: string[]) {
  if (!userIds.length) return;
  try {
    await call("conversations.invite", { channel, users: userIds.join(","), force: true });
  } catch (e) {
    if (!(e instanceof SlackError) || e.code !== "already_in_channel") throw e;
  }
}
