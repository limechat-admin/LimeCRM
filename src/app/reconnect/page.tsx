import { Group, SimpleGrid, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";
import type { Metadata } from "next";
import classes from "@/components/board.module.css";
import { AnchorLink, LinkButton } from "@/components/links";
import { Empty, LifecycleBadge, MetricCard, PageHeader, Section } from "@/components/ui";
import { reconnectBucket, type ReconnectBucket } from "@/domain/reconnect";
import { LIFECYCLE_LABEL, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { listReconnects } from "@/server/reconnect";

export const metadata: Metadata = { title: "Reconnect" };

const BUCKETS: { key: ReconnectBucket; title: string; empty: string }[] = [
  { key: "overdue", title: "Overdue", empty: "Nothing overdue" },
  { key: "this_week", title: "This week", empty: "Nothing this week" },
  { key: "later", title: "Later", empty: "Nothing scheduled" },
];

// The later list can run to thousands after the Salesmate import; the nearest ones matter.
const LATER_LIMIT = 100;

type Row = Awaited<ReturnType<typeof listReconnects>>[number];

function ReconnectTable({ rows, showAe }: { rows: Row[]; showAe: boolean }) {
  return (
    <TableScrollContainer minWidth={640}>
      <Table>
        <TableThead>
          <TableTr>
            <TableTh>Company</TableTh>
            <TableTh style={{ whiteSpace: "nowrap" }}>Reconnect on</TableTh>
            <TableTh>Why later</TableTh>
            {showAe && <TableTh>AE</TableTh>}
          </TableTr>
        </TableThead>
        <TableTbody>
          {rows.map((r) => (
            <TableTr key={r.id}>
              <TableTd>
                <Group gap={6} wrap="nowrap">
                  <AnchorLink href={`/companies/${r.id}`} className={classes.rowLink}>
                    {r.name}
                  </AnchorLink>
                  {r.lifecycle !== "prospect" && <LifecycleBadge lifecycle={r.lifecycle} label={LIFECYCLE_LABEL[r.lifecycle]} />}
                </Group>
              </TableTd>
              <TableTd>
                <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                  {shortDate(r.reconnectOn)}
                </Text>
              </TableTd>
              <TableTd maw={360}>
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {r.reconnectReason ?? "—"}
                </Text>
              </TableTd>
              {showAe && (
                <TableTd>
                  <Text size="sm">{r.aeName ?? "No AE"}</Text>
                </TableTd>
              )}
            </TableTr>
          ))}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}

export default async function ReconnectPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const user = await getCurrentUser();
  const everyone = (await searchParams).scope === "all";
  const rows = await listReconnects(everyone ? undefined : user.id);
  const now = new Date();
  const grouped: Record<ReconnectBucket, Row[]> = { overdue: [], this_week: [], later: [] };
  for (const r of rows) grouped[reconnectBucket(r.reconnectOn!, now)].push(r);
  const noAe = rows.filter((r) => !r.aeId).length;

  return (
    <>
      <PageHeader
        title="Reconnect"
        subtitle={`Companies to get back in touch with, soonest first. On the day, the AE gets a task in My work.${everyone ? "" : " Showing yours."}`}
        actions={
          <Group gap={6}>
            <LinkButton href="/reconnect" size="xs" variant={everyone ? "default" : "filled"}>
              Mine
            </LinkButton>
            <LinkButton href="/reconnect?scope=all" size="xs" variant={everyone ? "filled" : "default"}>
              Everyone
            </LinkButton>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Overdue" value={grouped.overdue.length} />
        <MetricCard label="This week" value={grouped.this_week.length} />
        <MetricCard label="Later" value={grouped.later.length} />
        <MetricCard label="Without an AE" value={noAe} hint={noAe ? "No task is opened for these" : undefined} />
      </SimpleGrid>
      <Stack gap="lg">
        {BUCKETS.map((b) => {
          const all = grouped[b.key];
          const shown = b.key === "later" ? all.slice(0, LATER_LIMIT) : all;
          return (
            <Section key={b.key} title={`${b.title} (${all.length})`}>
              {all.length === 0 ? (
                <Empty compact>{b.empty}</Empty>
              ) : (
                <>
                  <ReconnectTable rows={shown} showAe={everyone} />
                  {shown.length < all.length && (
                    <Text size="xs" c="dimmed" mt="xs">
                      Showing the next {shown.length} of {all.length}.
                    </Text>
                  )}
                </>
              )}
            </Section>
          );
        })}
      </Stack>
    </>
  );
}
