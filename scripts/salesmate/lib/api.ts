import { sleep } from "./util";

export const LINKNAME = "limechat.salesmate.io";
// Overridable only so the extractor can be exercised against a local mock.
const BASE = process.env.SALESMATE_BASE_URL ?? `https://${LINKNAME}`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

type Envelope = { Status?: string; Data?: unknown; Error?: unknown; Message?: unknown };

/**
 * Thin Salesmate REST client: polite pacing (a minimum gap between request starts),
 * retries with backoff on 429 / 5xx / network errors, and it never logs the token.
 */
export class SalesmateApi {
  private nextSlot = 0;
  private minIntervalMs: number;
  requests = 0;

  constructor(
    private readonly token: string,
    private readonly baseIntervalMs = 300,
  ) {
    this.minIntervalMs = baseIntervalMs;
  }

  static fromEnv(rps: number) {
    const token = process.env.SALESMATE_ACCESS_TOKEN?.trim();
    if (!token) {
      throw new Error(
        "SALESMATE_ACCESS_TOKEN is not set. Add the *rotated* token to .env (the one in Notion is leaked and must not be used).",
      );
    }
    return new SalesmateApi(token, Math.ceil(1000 / rps));
  }

  private async slot() {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.minIntervalMs;
    if (at > now) await sleep(at - now);
  }

  async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const maxAttempts = 6;
    for (let attempt = 1; ; attempt++) {
      await this.slot();
      this.requests++;
      let res: Response;
      try {
        res = await fetch(`${BASE}${path}`, {
          method,
          headers: {
            accessToken: this.token,
            "x-linkname": LINKNAME,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt >= maxAttempts) throw e;
        await this.backoff(attempt, `${method} ${path}: ${(e as Error).message}`);
        continue;
      }

      const text = await res.text();
      if (res.ok) this.minIntervalMs = Math.max(this.baseIntervalMs, this.minIntervalMs * 0.97);
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxAttempts) throw new ApiError(`${method} ${path} → ${res.status}`, res.status, text.slice(0, 500));
        // Back off harder after a 429; recovers gradually on success (below).
        if (res.status === 429) this.minIntervalMs = Math.min(this.minIntervalMs * 1.5, this.baseIntervalMs * 8, 5000);
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.backoff(attempt, `${method} ${path} → ${res.status}`, retryAfter > 0 ? retryAfter * 1000 : undefined);
        continue;
      }
      if (!res.ok) throw new ApiError(`${method} ${path} → ${res.status}`, res.status, text.slice(0, 500));

      let json: Envelope;
      try {
        json = JSON.parse(text) as Envelope;
      } catch {
        throw new ApiError(`${method} ${path} → non-JSON response`, res.status, text.slice(0, 500));
      }
      if (json.Status && json.Status.toLowerCase() !== "success") {
        throw new ApiError(`${method} ${path} → Status=${json.Status}`, res.status, text.slice(0, 500));
      }
      return json.Data !== undefined ? json.Data : json;
    }
  }

  private async backoff(attempt: number, why: string, ms?: number) {
    const wait = ms ?? Math.min(2 ** attempt * 1000, 60_000) + Math.random() * 500;
    console.warn(`  retry ${attempt} in ${Math.round(wait / 1000)}s (${why})`);
    await sleep(wait);
  }
}
