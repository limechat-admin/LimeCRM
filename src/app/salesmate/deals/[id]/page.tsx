import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LinkButton } from "@/components/links";
import { StatusScreen } from "@/components/status-screen";
import { getCurrentUser } from "@/server/auth";
import { dealForSalesmateId } from "@/server/work";

export const metadata: Metadata = { title: "Salesmate link" };

/**
 * /salesmate/deals/14997 → the LimeCRM deal it was migrated into. Clones in the Onboarding and CS
 * pipelines all point at the one deal. Old links can be rewritten to this path at cutover.
 */
export default async function SalesmateDealRedirect({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const n = /^\d{1,7}$/.test(id) ? Number(id) : null;
  const dealId = n ? await dealForSalesmateId(n) : null;
  if (dealId) redirect(`/deals/${dealId}`);
  return (
    <StatusScreen title="Not in LimeCRM yet" actions={<LinkButton href={`/search?q=${encodeURIComponent(id)}`}>Search for it</LinkButton>}>
      Salesmate deal {id} wasn&apos;t migrated as a deal. Reconnect-pipeline deals became nurture leads, and some old deals were merged into
      their company. Try searching for the company name.
    </StatusScreen>
  );
}
