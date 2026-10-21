import { Badge, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import type { Metadata } from "next";
import { moveOnboardingAction } from "@/app/actions";
import { DragBoard, DragCard, DropColumn } from "@/components/board-dnd";
import classes from "@/components/board.module.css";
import { Empty, HEALTH_COLOR, MetricCard, PageHeader } from "@/components/ui";
import { inr, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getOnboardingBoard } from "@/server/queries";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  await getCurrentUser();
  const columns = await getOnboardingBoard();
  const inFlight = columns.flatMap((c) => c.items);
  const noOm = inFlight.filter((i) => !i.omName).length;
  return (
    <>
      <PageHeader title="Onboarding" subtitle="Won deals being implemented, from kick-off to handover to CS. Drag a card to move it." />
      <SimpleGrid cols={{ base: 2, md: 3 }} mb="lg">
        <MetricCard label="In flight" value={inFlight.length} />
        <MetricCard label="MRR being onboarded" value={inr(inFlight.reduce((a, i) => a + i.mrr, 0))} />
        <MetricCard label="Without an onboarding manager" value={noOm} />
      </SimpleGrid>
      <DragBoard action={moveOnboardingAction} idField="onboardingId">
        <div className={classes.scroller}>
          <div className={classes.columns}>
            {columns
              .filter((c) => c.stage.kind !== "won")
              .map(({ stage, items }) => (
                <DropColumn
                  key={stage.id}
                  stageKey={stage.key}
                  stageName={stage.name}
                  className={`${classes.column} ${stage.kind === "hold" ? classes.columnHold : classes.columnOpen}`}
                >
                  <Group justify="space-between" px={4} mb="xs">
                    <Text fw={700} size="sm">
                      {stage.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {items.length}
                    </Text>
                  </Group>
                  <Stack gap={6}>
                    {items.length === 0 && <Empty compact>Nobody here</Empty>}
                    {items.map((i) => (
                      <DragCard key={i.id} id={i.id} stageKey={stage.key} href={`/companies/${i.orgId}`}>
                        <Group justify="space-between" wrap="nowrap" align="flex-start">
                          <Text size="sm" fw={700}>
                            {i.orgName}
                          </Text>
                          {i.health && <Badge color={HEALTH_COLOR[i.health]}>{i.health}</Badge>}
                        </Group>
                        <Text size="sm" fw={600} mt={4}>
                          {inr(i.mrr)}
                          <Text span size="xs" c="dimmed">
                            /mo
                          </Text>
                        </Text>
                        <Text size="xs" c="dimmed" mt={2}>
                          {i.omName ?? "No onboarding manager"} · kick-off {shortDate(i.kickoffDate)}
                        </Text>
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
