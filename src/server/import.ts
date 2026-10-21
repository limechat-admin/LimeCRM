import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { contacts, users } from "@/db/schema";
import type { LeadImportRow } from "@/domain/csv";
import { createLead } from "./leads";

export type ImportSummary = {
  created: number;
  duplicates: { row: number; email: string }[];
  failed: { row: number; message: string }[];
};

/**
 * Create leads from validated import rows. People already in LimeCRM (same email, any case) are
 * skipped and reported, never overwritten. SDR/AE are matched to LimeCRM users by email; an
 * unknown email fails that row rather than silently dropping the owner.
 */
export async function importLeads(rows: { row: number; data: LeadImportRow }[], actorId: string): Promise<ImportSummary> {
  const summary: ImportSummary = { created: 0, duplicates: [], failed: [] };

  const emails = [...new Set(rows.map((r) => r.data.email).filter((e): e is string => !!e))];
  const existing = new Set<string>();
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const found = await db
      .select({ email: sql<string>`lower(${contacts.email})` })
      .from(contacts)
      .where(inArray(sql`lower(${contacts.email})`, chunk));
    found.forEach((f) => existing.add(f.email));
  }

  const userEmails = [...new Set(rows.flatMap((r) => [r.data.sdrEmail, r.data.ownerEmail]).filter((e): e is string => !!e))];
  const people = userEmails.length
    ? await db.select({ id: users.id, email: sql<string>`lower(${users.email})` }).from(users).where(inArray(sql`lower(${users.email})`, userEmails))
    : [];
  const userId = new Map(people.map((p) => [p.email, p.id]));

  for (const { row, data } of rows) {
    if (data.email && existing.has(data.email)) {
      summary.duplicates.push({ row, email: data.email });
      continue;
    }
    const sdrId = data.sdrEmail ? userId.get(data.sdrEmail) : null;
    const ownerId = data.ownerEmail ? userId.get(data.ownerEmail) : null;
    if (sdrId === undefined) {
      summary.failed.push({ row, message: `SDR ${data.sdrEmail} isn't a LimeCRM user` });
      continue;
    }
    if (ownerId === undefined) {
      summary.failed.push({ row, message: `AE ${data.ownerEmail} isn't a LimeCRM user` });
      continue;
    }
    try {
      await createLead(
        {
          name: data.name,
          email: data.email,
          phone: data.phone,
          designation: data.designation,
          companyName: data.companyName,
          website: data.website,
          source: data.source,
          linkedinUrl: data.linkedinUrl,
          sdrId,
          ownerId,
        },
        actorId,
      );
      summary.created++;
      if (data.email) existing.add(data.email);
    } catch (e) {
      summary.failed.push({ row, message: e instanceof Error ? e.message : "Could not create this lead" });
    }
  }
  return summary;
}
