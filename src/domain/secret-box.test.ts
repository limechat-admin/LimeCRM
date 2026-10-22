import { describe, expect, it } from "vitest";
import { newNonce, seal, signState, unseal, verifyState } from "./secret-box";

const secret = "test-secret-please-ignore";

describe("seal", () => {
  it("round-trips and doesn't leak the plaintext", () => {
    const s = seal("1//refresh-token", secret);
    expect(s).not.toContain("refresh");
    expect(unseal(s, secret)).toBe("1//refresh-token");
    expect(seal("x", secret)).not.toBe(seal("x", secret));
  });
  it("refuses the wrong key or a tampered value", () => {
    const s = seal("1//refresh-token", secret);
    expect(() => unseal(s, "other-secret")).toThrow();
    expect(() => unseal(s.slice(0, -2) + "AA", secret)).toThrow();
  });
});

describe("state", () => {
  it("verifies within its lifetime only, and only with the right secret", () => {
    const nonce = newNonce();
    const s = signState("user-1", nonce, secret, 1_000);
    expect(verifyState(s, secret, 2_000)).toEqual({ userId: "user-1", nonce });
    expect(verifyState(s, secret, 1_000 + 11 * 60_000)).toBeNull();
    expect(verifyState(s, "other-secret", 2_000)).toBeNull();
    expect(verifyState(s.replace(/^./, "x"), secret, 2_000)).toBeNull();
  });
});
