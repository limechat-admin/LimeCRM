/**
 * Minimal Gmail API client for read-only sync, plus the OAuth pieces for "Connect Gmail". Uses the
 * same Google OAuth client as sign-in (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET); its consent screen must
 * include the gmail.readonly scope and the redirect URI <APP_URL>/api/gmail/callback.
 */
import type { MailHeaders } from "@/domain/mail";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Ties Google's redirect back to the browser that started "Connect Gmail". */
export const NONCE_COOKIE = "lc-gmail-nonce";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const gmailConfigured = () => !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const redirectUri = () => `${appUrl()}/api/gmail/callback`;

/** Key that seals refresh tokens. */
export function tokenKey(): string {
  const k = process.env.MAIL_TOKEN_KEY || process.env.AUTH_SECRET;
  if (!k) throw new Error("Set MAIL_TOKEN_KEY (or AUTH_SECRET) to store Gmail connections");
  return k;
}

export class GmailError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** The user revoked access, or the token is otherwise dead: reconnecting is the only fix. */
  get revoked() {
    return this.code === "invalid_grant" || this.status === 401;
  }
}

export function consentUrl(state: string, loginHint: string) {
  const params = new URLSearchParams({
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `openid email ${GMAIL_SCOPE}`,
    access_type: "offline",
    // Always ask, so Google returns a refresh token even if the user connected before.
    prompt: "consent",
    include_granted_scopes: "true",
    login_hint: loginHint,
    hd: loginHint.split("@")[1] ?? "",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000) });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string; scope?: string };
  if (!res.ok || !json.access_token)
    throw new GmailError(res.status, json.error ?? "token_error", json.error_description ?? json.error ?? `HTTP ${res.status}`);
  return json;
}

export function exchangeCode(code: string) {
  return tokenRequest({
    code,
    client_id: process.env.AUTH_GOOGLE_ID ?? "",
    client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(
    () => {},
  );
}

// ---------- the read-only client ----------

export type GmailMessage = { id: string; threadId: string; snippet: string; headers: MailHeaders };

/** What sync needs from Gmail. The real one is below; tests pass a fake. */
export interface GmailClient {
  profile(): Promise<{ emailAddress: string; historyId: string }>;
  /** Message ids matching a Gmail search, newest first. */
  list(q: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** Messages added since `startHistoryId`; null when that history id is too old (resync by date). */
  history(startHistoryId: string, pageToken?: string): Promise<{ ids: string[]; historyId: string; nextPageToken?: string } | null>;
  get(id: string): Promise<GmailMessage | null>;
}

const HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID", "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted"];

export function gmailClient(refreshToken: string): GmailClient {
  let access: { token: string; until: number } | null = null;
  const token = async () => {
    if (access && access.until > Date.now() + 30_000) return access.token;
    const t = await tokenRequest({
      refresh_token: refreshToken,
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      grant_type: "refresh_token",
    });
    access = { token: t.access_token!, until: Date.now() + 50 * 60_000 };
    return access.token;
  };
  const call = async <T>(path: string): Promise<{ status: number; json: T }> => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(20_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
      if (!res.ok && res.status !== 404)
        throw new GmailError(res.status, json.error?.status ?? `http_${res.status}`, json.error?.message ?? `Gmail HTTP ${res.status}`);
      return { status: res.status, json };
    }
  };
  return {
    async profile() {
      return (await call<{ emailAddress: string; historyId: string }>("/profile")).json;
    },
    async list(q, pageToken) {
      const p = new URLSearchParams({ q, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
      const { json } = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${p}`);
      return { ids: (json.messages ?? []).map((m) => m.id), nextPageToken: json.nextPageToken };
    },
    async history(startHistoryId, pageToken) {
      const p = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500", ...(pageToken ? { pageToken } : {}) });
      const { status, json } = await call<{
        history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[];
        historyId: string;
        nextPageToken?: string;
      }>(`/history?${p}`);
      if (status === 404) return null;
      const ids = (json.history ?? []).flatMap((h) => (h.messagesAdded ?? []).filter((m) => !m.message.labelIds?.includes("DRAFT")).map((m) => m.message.id));
      return { ids: [...new Set(ids)], historyId: json.historyId, nextPageToken: json.nextPageToken };
    },
    async get(id) {
      const p = new URLSearchParams({ format: "metadata" });
      HEADERS.forEach((h) => p.append("metadataHeaders", h));
      const { status, json } = await call<{
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: { name: string; value: string }[] };
      }>(`/messages/${id}?${p}`);
      if (status === 404 || json.labelIds?.includes("DRAFT") || json.labelIds?.includes("SPAM")) return null;
      const h = (name: string) => json.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? null;
      return {
        id: json.id,
        threadId: json.threadId,
        snippet: json.snippet ?? "",
        headers: {
          from: h("From"),
          to: h("To"),
          cc: h("Cc"),
          subject: h("Subject"),
          date: h("Date"),
          messageId: h("Message-ID"),
          listUnsubscribe: h("List-Unsubscribe"),
          listId: h("List-Id"),
          precedence: h("Precedence"),
          autoSubmitted: h("Auto-Submitted"),
        },
      };
    },
  };
}
