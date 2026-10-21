import {
  Badge,
  Card,
  Code,
  Group,
  List,
  ListItem,
  SimpleGrid,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";
import { desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sendPendingNotificationsAction } from "@/app/actions";
import { InlineAction, SubmitButton } from "@/components/forms";
import { Empty, MetricCard, PageHeader, Section } from "@/components/ui";
import { db } from "@/db";
import { notifications, organizations } from "@/db/schema";
import { dateTime } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Notifications" };

const KIND_LABEL: Record<string, string> = {
  deal_won: "Deal won",
  deal_lost: "Deal lost",
  handed_to_cs: "Handed to CS",
  churned: "Churn alert",
  client_channel: "Client channel",
  renewal_due: "Renewal reminder",
  daily_digest: "Daily digest",
};

const STATUS_COLOR: Record<string, string> = { sent: "green", pending: "yellow", sending: "yellow", failed: "red", skipped: "gray" };

const TARGET_LABEL = (t: string) =>
  t === "deals" ? "Deals channel" : t === "alerts" ? "Alerts channel" : t === "create_channel" ? "New client-o channel" : t.startsWith("user:") ? `DM ${t.slice(5)}` : t;

function SetupItem({ name, set, why }: { name: string; set: boolean; why: string }) {
  return (
    <ListItem>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <Badge color={set ? "green" : "gray"} miw={74}>
          {set ? "Set" : "Missing"}
        </Badge>
        <div>
          <Code>{name}</Code>
          <Text size="xs" c="dimmed">
            {why}
          </Text>
        </div>
      </Group>
    </ListItem>
  );
}

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (user.role !== "admin") notFound();
  const [rows, counts] = await Promise.all([
    db
      .select({ n: notifications, company: organizations.name })
      .from(notifications)
      .leftJoin(organizations, eq(organizations.id, notifications.orgId))
      .orderBy(desc(notifications.createdAt))
      .limit(100),
    db.select({ status: notifications.status, n: sql<number>`count(*)::int` }).from(notifications).groupBy(notifications.status),
  ]);
  const count = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>;
  const env = (k: string) => !!process.env[k];

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Slack messages LimeCRM sends: wins, losses, handovers, churn alerts, renewal reminders and morning digests."
        actions={
          <InlineAction action={sendPendingNotificationsAction} hidden={{}}>
            <SubmitButton size="xs" variant="default">
              Send pending now
            </SubmitButton>
          </InlineAction>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Sent" value={count.sent ?? 0} />
        <MetricCard label="Waiting" value={(count.pending ?? 0) + (count.sending ?? 0)} />
        <MetricCard label="Failed" value={count.failed ?? 0} />
        <MetricCard label="Skipped" value={count.skipped ?? 0} hint={env("SLACK_BOT_TOKEN") ? "No channel set for the target" : "Slack isn't connected yet"} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="lg">
        <Section title="Slack setup">
          <List spacing="sm" listStyleType="none">
            <SetupItem name="SLACK_BOT_TOKEN" set={env("SLACK_BOT_TOKEN")} why="The LimeCRM Slack app's bot token (xoxb-…)" />
            <SetupItem name="SLACK_DEALS_CHANNEL_ID" set={env("SLACK_DEALS_CHANNEL_ID")} why="Where wins, losses and handovers are posted" />
            <SetupItem name="SLACK_ALERTS_CHANNEL_ID" set={env("SLACK_ALERTS_CHANNEL_ID")} why="Where churn alerts and renewal reminders go" />
            <SetupItem name="SLACK_METRIC_BOT_USER_ID" set={env("SLACK_METRIC_BOT_USER_ID")} why="Optional: Metric Bot, added to every new client-o channel" />
            <SetupItem name="CRON_SECRET" set={env("CRON_SECRET")} why="Protects the scheduled jobs (digests, renewals, retries)" />
            <SetupItem name="APP_URL" set={env("APP_URL")} why="LimeCRM's public URL, for links in messages" />
          </List>
        </Section>

        <div style={{ gridColumn: "span 2" }}>
          <Card withBorder p={0}>
            {rows.length === 0 ? (
              <Empty>Nothing yet. Win, lose or hand over a deal and it shows up here.</Empty>
            ) : (
              <TableScrollContainer minWidth={720}>
                <Table>
                  <TableThead>
                    <TableTr>
                      <TableTh>What</TableTh>
                      <TableTh>Where</TableTh>
                      <TableTh>Status</TableTh>
                      <TableTh>When</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {rows.map(({ n, company }) => (
                      <TableTr key={n.id}>
                        <TableTd>
                          <Text size="sm" fw={600}>
                            {KIND_LABEL[n.kind] ?? n.kind}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {company ?? (n.payload.name as string | undefined) ?? ""}
                          </Text>
                        </TableTd>
                        <TableTd>
                          <Text size="sm">{TARGET_LABEL(n.target)}</Text>
                        </TableTd>
                        <TableTd>
                          <Badge color={STATUS_COLOR[n.status]}>{n.status}</Badge>
                          {n.lastError && (
                            <Text size="xs" c={n.status === "failed" ? "red" : "dimmed"}>
                              {n.lastError}
                              {n.attempts > 1 ? ` · ${n.attempts} tries` : ""}
                            </Text>
                          )}
                        </TableTd>
                        <TableTd>
                          <Text size="xs">{dateTime(n.createdAt)}</Text>
                          {n.sentAt && (
                            <Text size="xs" c="dimmed">
                              sent {dateTime(n.sentAt)}
                            </Text>
                          )}
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </TableScrollContainer>
            )}
          </Card>
        </div>
      </SimpleGrid>
    </>
  );
}
