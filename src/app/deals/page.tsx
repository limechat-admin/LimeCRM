import { Button, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { CalendarDays, Download } from "lucide-react";
import type { Metadata } from "next";
import { moveDealAction } from "@/app/actions";
import { DragBoard, DragCard, DropColumn } from "@/components/board-dnd";
import classes from "@/components/board.module.css";
import { Empty, MetricCard, PageHeader } from "@/components/ui";
import { inr, inrCompact, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getDealBoard } from "@/server/queries";

export const metadata: Metadata = { title: "Deals" };

const COLUMN_CLASS = {
  open: classes.columnOpen,
  won: classes.columnWon,
  lost: classes.columnLost,
  hold: classes.columnHold,
};

export default async function DealsPage() {
  await getCurrentUser();
  const columns = await getDealBoard();
  const open = columns.filter((c) => c.stage.kind === "open");
  const openCount = open.reduce((a, c) => a + c.deals.length, 0);
  const openValue = open.reduce((a, c) => a + c.total, 0);
  const weighted = open.reduce((a, c) => a + (c.total * (c.stage.winProbability ?? 0)) / 100, 0);
  const won = columns.filter((c) => c.stage.kind === "won").reduce((a, c) => a + c.total, 0);

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle="Every sale from qualified meeting to handover. Drag a card to move it. MRR is monthly, in INR."
        actions={
          <Button component="a" href="/export/deals.csv" variant="default" size="xs" leftSection={<Download size={14} />}>
            Export CSV
          </Button>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Open deals" value={openCount} />
        <MetricCard label="Pipeline MRR" value={inr(openValue)} />
        <MetricCard label="Weighted MRR" value={inr(weighted)} hint="By stage win probability" />
        <MetricCard label="Won MRR (live contracts)" value={inr(won)} />
      </SimpleGrid>
      <DragBoard action={moveDealAction} idField="dealId">
        <div className={classes.scroller}>
          <div className={classes.columns}>
            {columns.map(({ stage, deals, total }) => (
              <DropColumn key={stage.id} stageKey={stage.key} stageName={stage.name} className={`${classes.column} ${COLUMN_CLASS[stage.kind]}`}>
                <Group justify="space-between" px={4} mb="xs" wrap="nowrap">
                  <Text fw={700} size="sm">
                    {stage.name}
                  </Text>
                  {stage.kind === "open" && stage.winProbability != null && (
                    <Text size="xs" c="dimmed">
                      {stage.winProbability}%
                    </Text>
                  )}
                </Group>
                <Text size="xs" c="dimmed" px={4} mb="xs">
                  {deals.length} · {inrCompact(total)}
                </Text>
                <Stack gap={6}>
                  {deals.length === 0 && <Empty compact>No deals</Empty>}
                  {deals.map((d) => (
                    <DragCard key={d.id} id={d.id} stageKey={stage.key} href={`/deals/${d.id}`}>
                      <Text size="sm" fw={700} lh="20px">
                        {d.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {d.orgName}
                      </Text>
                      <Group justify="space-between" mt={6} wrap="nowrap">
                        <Text size="sm" fw={600}>
                          {inr(d.mrr)}
                          <Text span size="xs" c="dimmed">
                            /mo
                          </Text>
                        </Text>
                        {d.expectedCloseDate && (
                          <Group gap={4} wrap="nowrap" c="dimmed">
                            <CalendarDays size={12} />
                            <Text size="xs">{shortDate(d.expectedCloseDate)}</Text>
                          </Group>
                        )}
                      </Group>
                      {d.ownerName && (
                        <Text size="xs" c="dimmed" mt={2}>
                          {d.ownerName}
                        </Text>
                      )}
                    </DragCard>
                  ))}
                </Stack>
              </DropColumn>
            ))}
          </div>
        </div>
      </DragBoard>
    </>
  );
}
