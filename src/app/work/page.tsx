import {
  Badge,
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
  Title,
} from "@mantine/core";
import type { Metadata } from "next";
import classes from "@/components/board.module.css";
import { AnchorLink, LinkButton } from "@/components/links";
import { CompleteTaskButton, DueBadge } from "@/components/timeline";
import { Empty, MetricCard, PageHeader, Section } from "@/components/ui";
import { STALE_DEAL_DAYS, type TaskBucket } from "@/domain/work";
import { ACTIVITY_LABEL, inr, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getMyWork, type MyWork } from "@/server/work";

export const metadata: Metadata = { title: "My work" };

const BUCKETS: { key: TaskBucket; title: string; empty: string }[] = [
  { key: "overdue", title: "Overdue", empty: "Nothing overdue" },
  { key: "today", title: "Today", empty: "Nothing due today" },
  { key: "upcoming", title: "Upcoming", empty: "Nothing scheduled" },
  { key: "someday", title: "No due date", empty: "" },
];

type Task = MyWork["tasks"]["overdue"][number];

function TaskRow({ t, showOwner }: { t: Task; showOwner: boolean }) {
  const href = t.dealId ? `/deals/${t.dealId}` : t.contactId ? `/leads/${t.contactId}` : t.orgId ? `/companies/${t.orgId}` : null;
  const about = t.dealTitle ?? t.contactName ?? t.orgName;
  return (
    <Group justify="space-between" wrap="nowrap" py="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Text size="sm">
          <Text span fw={700}>
            {ACTIVITY_LABEL[t.type]}:
          </Text>{" "}
          {t.subject}
        </Text>
        <Text size="xs" c="dimmed">
          {href && about ? (
            <AnchorLink href={href} size="xs">
              {about}
            </AnchorLink>
          ) : (
            "Not linked"
          )}
          {showOwner && t.ownerName ? ` · ${t.ownerName}` : ""}
        </Text>
      </Stack>
      <Group gap="xs" wrap="nowrap">
        <DueBadge dueAt={t.dueAt} />
        <CompleteTaskButton activityId={t.id} subject={t.subject} />
      </Group>
    </Group>
  );
}

export default async function WorkPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const user = await getCurrentUser();
  const team = (await searchParams).scope === "team";
  const { tasks, stale, openDealCount } = await getMyWork(team ? null : user.id);
  const openTasks = BUCKETS.reduce((a, b) => a + tasks[b.key].length, 0);

  return (
    <>
      <PageHeader
        title="My work"
        subtitle={team ? "Everyone's open tasks and the deals that have gone quiet." : "Your open tasks and the deals that have gone quiet."}
        actions={
          <Group gap={6}>
            <LinkButton href="/work" size="xs" variant={team ? "default" : "filled"}>
              Mine
            </LinkButton>
            <LinkButton href="/work?scope=team" size="xs" variant={team ? "filled" : "default"}>
              Team
            </LinkButton>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Overdue" value={tasks.overdue.length} />
        <MetricCard label="Due today" value={tasks.today.length} />
        <MetricCard label="Open tasks" value={openTasks} />
        <MetricCard label="Stale deals" value={stale.length} hint={`No touch in ${STALE_DEAL_DAYS}+ days, of ${openDealCount} open`} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Section title="Tasks">
          {openTasks === 0 ? (
            <Empty>You&apos;re all caught up</Empty>
          ) : (
            <Stack gap="md">
              {BUCKETS.filter((b) => tasks[b.key].length > 0 || b.key !== "someday").map((b) => (
                <div key={b.key}>
                  <Group gap="xs" mb={4}>
                    <Title order={6}>{b.title}</Title>
                    <Badge color={b.key === "overdue" && tasks.overdue.length ? "red" : "gray"}>{tasks[b.key].length}</Badge>
                  </Group>
                  {tasks[b.key].length === 0 ? (
                    <Text size="xs" c="dimmed">
                      {b.empty}
                    </Text>
                  ) : (
                    tasks[b.key].map((t) => <TaskRow key={t.id} t={t} showOwner={team} />)
                  )}
                </div>
              ))}
            </Stack>
          )}
          <Text size="xs" c="dimmed" mt="sm">
            Add a task from any deal, company or lead: log an activity with a follow-up date.
          </Text>
        </Section>

        <Section title={`Stale deals (${stale.length})`}>
          {stale.length === 0 ? (
            <Empty>Every open deal has been touched in the last {STALE_DEAL_DAYS} days</Empty>
          ) : (
            <Card withBorder p={0}>
              <TableScrollContainer minWidth={480}>
                <Table highlightOnHover>
                  <TableThead>
                    <TableTr>
                      <TableTh>Deal</TableTh>
                      <TableTh>Stage</TableTh>
                      <TableTh ta="right">MRR</TableTh>
                      <TableTh>Last touch</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {stale.map((d) => (
                      <TableTr key={d.id}>
                        <TableTd>
                          <AnchorLink href={`/deals/${d.id}`} className={classes.rowLink} underline="never">
                            {d.title}
                          </AnchorLink>
                          <Text size="xs" c="dimmed">
                            {d.orgName}
                            {team && d.ownerName ? ` · ${d.ownerName}` : ""}
                          </Text>
                        </TableTd>
                        <TableTd>{d.stageName}</TableTd>
                        <TableTd ta="right" fw={600}>
                          {inr(d.mrr)}
                        </TableTd>
                        <TableTd>
                          <Badge color={d.idleDays === null || d.idleDays >= STALE_DEAL_DAYS * 2 ? "red" : "yellow"}>
                            {d.idleDays === null ? "Never" : `${d.idleDays}d ago`}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {shortDate(d.lastTouch)}
                          </Text>
                        </TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </TableScrollContainer>
            </Card>
          )}
        </Section>
      </SimpleGrid>
    </>
  );
}
