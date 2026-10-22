/**
 * Secrets at rest and signed OAuth state. Gmail refresh tokens are stored encrypted with
 * AES-256-GCM under a key derived from AUTH_SECRET (or MAIL_TOKEN_KEY), so a database dump alone
 * can't read anyone's mail. OAuth `state` is HMAC-signed and short-lived, binding the Google
 * redirect to the user who started it.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const keyFrom = (secret: string, purpose: string) => createHash("sha256").update(`limecrm:${purpose}:${secret}`).digest();

/** "v1.<iv>.<tag>.<ciphertext>", all base64url. */
export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret, "seal"), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function unseal(sealed: string, secret: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Not a sealed value");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret, "seal"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** A signed, expiring state value carrying a user id and a nonce. */
export function signState(userId: string, nonce: string, secret: string, now = Date.now(), ttlMs = 10 * 60_000): string {
  const body = Buffer.from(JSON.stringify({ u: userId, n: nonce, e: now + ttlMs })).toString("base64url");
  const sig = createHmac("sha256", keyFrom(secret, "state")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string, secret: string, now = Date.now()): { userId: string; nonce: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", keyFrom(secret, "state")).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { u, n, e } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u: string; n: string; e: number };
    return e > now ? { userId: u, nonce: n } : null;
  } catch {
    return null;
  }
}

export const newNonce = () => randomBytes(16).toString("base64url");
