import type { Tx } from "@/db";
import { events } from "@/db/schema";

export type EntityType = "organization" | "deal" | "onboarding" | "contact";

export async function recordEvent(
  tx: Tx,
  e: { entityType: EntityType; entityId: string; orgId: string | null; actorId: string | null; action: string; data?: Record<string, unknown> },
) {
  await tx.insert(events).values({ ...e, data: e.data ?? {} });
}

/** Field-level diff for "Updates" timelines. Only keys present in `patch` are compared. */
export function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const from = before[key];
    const to = patch[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes[key as string] = { from, to };
  }
  return changes;
}
