import type { Metadata } from "next";
import { LeadImporter } from "@/components/lead-importer";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Import leads" };

export default async function ImportLeadsPage() {
  await getCurrentUser();
  return (
    <>
      <PageHeader title="Import leads" subtitle="Bring in an outbound list, event leads or a partner sheet from a CSV file." />
      <LeadImporter />
    </>
  );
}
