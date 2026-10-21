import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deals } from "@/db/schema";

/** The deal as stored, for permission checks that depend on its status or current values. */
export async function getDealForAuthz(id: string) {
  if (!z.string().uuid().safeParse(id).success) return undefined;
  const [deal] = await db.select().from(deals).where(eq(deals.id, id));
  return deal;
}
