/**
 * Postmark for campaign email. Sends through a Broadcast message stream (POSTMARK_STREAM, default
 * "broadcast"), never the transactional one, so campaign reputation stays separate.
 *
 * Env: POSTMARK_SERVER_TOKEN (Server → API Tokens), POSTMARK_STREAM, MAIL_FROM_DOMAIN (the verified
 * sending domain; campaigns may only send from it), MAIL_POSTAL_ADDRESS (shown in every footer),
 * POSTMARK_WEBHOOK_SECRET (Basic auth password on the webhook URL).
 */

export type OutgoingEmail = {
  From: string;
  To: string;
  ReplyTo?: string;
  Subject: string;
  HtmlBody: string;
  TextBody: string;
  MessageStream: string;
  Tag?: string;
  TrackOpens: boolean;
  TrackLinks: "HtmlAndText";
  Headers: { Name: string; Value: string }[];
  Metadata: Record<string, string>;
};

/** Per-message result, in the order sent. ErrorCode 0 is success; 406 means Postmark has the address suppressed. */
export type SendResult = { ErrorCode: number; Message: string; MessageID?: string; To?: string };

export interface MailDriver {
  sendBatch(messages: OutgoingEmail[]): Promise<SendResult[]>;
}

export const BATCH_SIZE = 500;
export const postmarkStream = () => process.env.POSTMARK_STREAM || "broadcast";
export const sendingDomain = () => (process.env.MAIL_FROM_DOMAIN || "").toLowerCase();

/** What's missing before campaigns can be sent from this server, in plain words. */
export function campaignSetupProblems(): string[] {
  const out: string[] = [];
  if (!process.env.POSTMARK_SERVER_TOKEN) out.push("POSTMARK_SERVER_TOKEN (Postmark server API token)");
  if (!process.env.MAIL_FROM_DOMAIN) out.push("MAIL_FROM_DOMAIN (the sending domain verified in Postmark)");
  if (!process.env.MAIL_POSTAL_ADDRESS) out.push("MAIL_POSTAL_ADDRESS (LimeChat's postal address, required in every marketing email)");
  return out;
}

export class PostmarkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function postmarkDriver(token = process.env.POSTMARK_SERVER_TOKEN ?? ""): MailDriver {
  return {
    async sendBatch(messages) {
      if (!messages.length) return [];
      for (let attempt = 1; ; attempt++) {
        const res = await fetch("https://api.postmarkapp.com/email/batch", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": token },
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(60_000),
        });
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        const json = (await res.json().catch(() => null)) as SendResult[] | { ErrorCode: number; Message: string } | null;
        if (!res.ok || !Array.isArray(json))
          throw new PostmarkError(res.status, (json && !Array.isArray(json) && json.Message) || `Postmark HTTP ${res.status}`);
        return json;
      }
    },
  };
}
