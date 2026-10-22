import { Alert, Badge, Card, Group, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";
import { desc, eq, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { SubmitButton } from "@/components/forms";
import { AnchorLink, LinkButton } from "@/components/links";
import { Empty, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { campaignRecipients, campaigns, emailLists } from "@/db/schema";
import { canWrite } from "@/domain/permissions";
import { dateTime } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { campaignSetupProblems } from "@/server/postmark";
import { createCampaignAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "gray" },
  scheduled: { label: "Scheduled", color: "yellow" },
  sending: { label: "Sending", color: "lime" },
  sent: { label: "Sent", color: "green" },
  cancelled: { label: "Cancelled", color: "gray" },
};
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

export default async function CampaignsPage() {
  const user = await getCurrentUser();
  const rows = await db
    .select({
      c: campaigns,
      list: emailLists.name,
      sent: sql<number>`(select count(*)::int from ${campaignRecipients} r where r.campaign_id = ${campaigns.id} and r.status = 'sent')`,
      delivered: sql<number>`(select count(delivered_at)::int from ${campaignRecipients} r where r.campaign_id = ${campaigns.id})`,
      opened: sql<number>`(select count(opened_at)::int from ${campaignRecipients} r where r.campaign_id = ${campaigns.id})`,
      clicked: sql<number>`(select count(clicked_at)::int from ${campaignRecipients} r where r.campaign_id = ${campaigns.id})`,
    })
    .from(campaigns)
    .leftJoin(emailLists, eq(emailLists.id, campaigns.listId))
    .orderBy(desc(campaigns.updatedAt));
  const setup = campaignSetupProblems();

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Marketing email to a list of leads or contacts, sent through Postmark, with opens, clicks and unsubscribes tracked."
        actions={
          <Group gap="xs">
            <LinkButton href="/campaigns/lists" size="xs" variant="default">
              Lists
            </LinkButton>
            {canWrite(user.role).ok && (
              <form action={createCampaignAction}>
                <SubmitButton size="xs" leftSection={<Plus size={14} />}>
                  New campaign
                </SubmitButton>
              </form>
            )}
          </Group>
        }
      />
      {setup.length > 0 && (
        <Alert color="yellow" variant="light" mb="lg" title="Sending isn't set up on this server yet">
          You can draft campaigns and lists now. To send, an admin sets: {setup.join("; ")}. See the README, &quot;Email campaigns&quot;.
        </Alert>
      )}
      <Card withBorder p={0}>
        {rows.length === 0 ? (
          <Empty>No campaigns yet</Empty>
        ) : (
          <TableScrollContainer minWidth={760}>
            <Table highlightOnHover>
              <TableThead>
                <TableTr>
                  <TableTh>Campaign</TableTh>
                  <TableTh>Status</TableTh>
                  <TableTh>List</TableTh>
                  <TableTh ta="right">Sent</TableTh>
                  <TableTh ta="right">Opened</TableTh>
                  <TableTh ta="right">Clicked</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {rows.map(({ c, list, sent, delivered, opened, clicked }) => (
                  <TableTr key={c.id}>
                    <TableTd>
                      <AnchorLink href={`/campaigns/${c.id}`} size="sm" fw={700} c="var(--mantine-color-text)">
                        {c.name}
                      </AnchorLink>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {c.subject || "No subject yet"}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <Badge color={STATUS[c.status]?.color}>{STATUS[c.status]?.label ?? c.status}</Badge>
                      <Text size="xs" c="dimmed">
                        {c.status === "scheduled" && c.scheduledAt ? dateTime(c.scheduledAt) : c.sentAt ? dateTime(c.sentAt) : ""}
                      </Text>
                    </TableTd>
                    <TableTd c="dimmed">{list ?? "—"}</TableTd>
                    <TableTd ta="right">{sent ? sent.toLocaleString("en-IN") : "—"}</TableTd>
                    <TableTd ta="right">{sent ? pct(opened, delivered) : "—"}</TableTd>
                    <TableTd ta="right">{sent ? pct(clicked, delivered) : "—"}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        )}
      </Card>
    </>
  );
}
