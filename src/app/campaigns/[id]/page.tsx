import {
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";
import { desc, eq } from "drizzle-orm";
import { Copy } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnchorLink } from "@/components/links";
import { Empty, MetricCard, PageHeader, Section } from "@/components/ui";
import { db } from "@/db";
import { campaignRecipients, campaigns, emailLists } from "@/db/schema";
import { blocksSchema, campaignRates, firstName, listFiltersSchema, renderEmail, SUBSCRIPTION_TYPES, type Vars } from "@/domain/campaigns";
import { isUuid } from "@/lib/ids";
import { dateTime } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { campaignCounts, campaignProblems, listMembers, logoUrl } from "@/server/campaigns";
import { deleteDraftAction, duplicateCampaignAction, type CampaignContent } from "../actions";
import { CampaignEditor } from "./editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [c] = isUuid(id) ? await db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, id)) : [];
  return { title: c?.name ?? "Campaign" };
}

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 1000) / 10}%`);
const STATUS_COLOR: Record<string, string> = { sent: "green", queued: "yellow", sending: "yellow", failed: "red", skipped: "gray" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!c) notFound();
  const lists = await db.select().from(emailLists).orderBy(emailLists.name);

  const header = (
    <PageHeader
      title={c.name}
      subtitle={<AnchorLink href="/campaigns">All campaigns</AnchorLink>}
      actions={
        <Group gap="xs">
          <form action={duplicateCampaignAction}>
            <input type="hidden" name="id" value={c.id} />
            <Button type="submit" size="xs" variant="default" leftSection={<Copy size={14} />}>
              Duplicate
            </Button>
          </form>
          {c.status === "draft" && (
            <form action={deleteDraftAction}>
              <input type="hidden" name="id" value={c.id} />
              <Button type="submit" size="xs" variant="subtle" color="red">
                Delete draft
              </Button>
            </form>
          )}
        </Group>
      }
    />
  );

  if (c.status === "draft" || c.status === "scheduled") {
    const listOptions = await Promise.all(
      lists.map(async (l) => ({ value: l.id, label: l.name, members: (await listMembers(listFiltersSchema.parse(l.filters), 1)).total })),
    );
    const selected = lists.find((l) => l.id === c.listId);
    const first = selected ? (await listMembers(listFiltersSchema.parse(selected.filters), 1)).rows[0] : undefined;
    const sample: Partial<Vars> = first
      ? { first_name: firstName(first.name), name: first.name, company: first.company ?? "", email: first.email, ae_name: first.aeName ?? "" }
      : { first_name: firstName(user.name), name: user.name, company: "Acme", email: user.email, ae_name: user.name };
    const blocks = blocksSchema.safeParse(c.blocks);
    return (
      <>
        {header}
        <CampaignEditor
          id={c.id}
          status={c.status}
          scheduledAt={c.scheduledAt?.toISOString() ?? null}
          initial={{
            name: c.name,
            listId: c.listId,
            subscriptionType: c.subscriptionType as CampaignContent["subscriptionType"],
            fromName: c.fromName,
            fromEmail: c.fromEmail,
            replyTo: c.replyTo,
            subject: c.subject,
            preheader: c.preheader,
            blocks: blocks.success ? blocks.data : [],
          }}
          lists={listOptions}
          sample={sample}
          problems={await campaignProblems(c)}
          canSend={user.role === "admin" || user.role === "sales"}
          logoUrl={logoUrl()}
        />
      </>
    );
  }

  // Sending or sent: results.
  const [counts, recipients] = await Promise.all([
    campaignCounts(c.id),
    db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.campaignId, c.id))
      .orderBy(desc(campaignRecipients.clicks), desc(campaignRecipients.opens))
      .limit(200),
  ]);
  const rates = campaignRates(counts);
  const list = lists.find((l) => l.id === c.listId);
  const sentHtml = renderEmail(
    { subject: c.subject, preheader: c.preheader, blocks: blocksSchema.parse(c.blocks), logoUrl: logoUrl() },
    { first_name: "there", sender_name: c.fromName },
    { companyLine: "LimeChat", address: process.env.MAIL_POSTAL_ADDRESS ?? "", unsubscribeUrl: "#", preferencesUrl: "#", reason: "" },
  ).html;
  return (
    <>
      {header}
      <Group gap="xs" mb="lg">
        <Badge color={c.status === "sent" ? "green" : "yellow"}>{c.status === "sent" ? "Sent" : "Sending"}</Badge>
        <Text size="sm" c="dimmed">
          {c.sentAt ? `Finished ${dateTime(c.sentAt)}` : c.startedAt ? `Started ${dateTime(c.startedAt)}` : ""} · {list?.name ?? "List deleted"} ·{" "}
          {SUBSCRIPTION_TYPES.find((t) => t.key === c.subscriptionType)?.label} · from {c.fromName} &lt;{c.fromEmail}&gt;
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 2, md: 6 }} mb="lg">
        <MetricCard label="Sent" value={counts.sent.toLocaleString("en-IN")} hint={counts.skipped ? `${counts.skipped} skipped` : undefined} />
        <MetricCard label="Delivered" value={pct(rates.delivery)} hint={`${counts.delivered.toLocaleString("en-IN")} emails`} />
        <MetricCard label="Opened" value={pct(rates.open)} hint={`${counts.opened.toLocaleString("en-IN")} people`} />
        <MetricCard label="Clicked" value={pct(rates.click)} hint={`${pct(rates.clickToOpen)} of opens`} />
        <MetricCard label="Bounced" value={pct(rates.bounce)} hint={`${counts.bounced} emails`} />
        <MetricCard label="Unsubscribed" value={counts.unsubscribed} hint={counts.complained ? `${counts.complained} spam complaints` : undefined} />
      </SimpleGrid>
      <Text size="xs" c="dimmed" mb="lg">
        Opens are approximate: Apple Mail opens everything automatically and some apps block tracking images. Clicks are the reliable signal.
      </Text>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Section title="Recipients">
          {recipients.length === 0 ? (
            <Empty compact>Nobody yet</Empty>
          ) : (
            <TableScrollContainer minWidth={520}>
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Email</TableTh>
                    <TableTh>Status</TableTh>
                    <TableTh ta="right">Opens</TableTh>
                    <TableTh ta="right">Clicks</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {recipients.map((r) => (
                    <TableTr key={r.id}>
                      <TableTd>
                        {r.contactId ? (
                          <AnchorLink href={`/leads/${r.contactId}`} size="sm">
                            {r.email}
                          </AnchorLink>
                        ) : (
                          r.email
                        )}
                        {(r.bouncedAt || r.complainedAt || r.unsubscribedAt) && (
                          <Text size="xs" c="red">
                            {r.complainedAt ? "Marked as spam" : r.bouncedAt ? `Bounced (${r.bounceType})` : "Unsubscribed"}
                          </Text>
                        )}
                      </TableTd>
                      <TableTd>
                        <Badge color={STATUS_COLOR[r.status]} title={r.skipReason ?? r.error ?? undefined}>
                          {r.status}
                        </Badge>
                      </TableTd>
                      <TableTd ta="right">{r.opens}</TableTd>
                      <TableTd ta="right">{r.clicks}</TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </TableScrollContainer>
          )}
        </Section>
        <Card withBorder>
          <Text fw={700} mb="xs">
            {c.subject}
          </Text>
          <iframe
            title="What was sent"
            srcDoc={sentHtml}
            sandbox="allow-same-origin"
            style={{ width: "100%", height: 560, border: "1px solid var(--mantine-color-default-border)", borderRadius: 4, background: "white" }}
          />
        </Card>
      </SimpleGrid>
      <Stack />
    </>
  );
}
