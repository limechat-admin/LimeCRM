/** Building blocks shared by the report cards (server components). */
import {
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
  Title,
} from "@mantine/core";
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { Empty } from "@/components/ui";
import { rangeParam, type DateRange } from "./range";
import { RangeFilter } from "./range-filter";
import classes from "./reports.module.css";

/** One report: title, description, its own date-range filter and a CSV download of its rows. */
export function ReportCard({
  id,
  title,
  description,
  range,
  rangeNote,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  range: DateRange;
  /** What the range applies to, when it isn't the whole report. */
  rangeNote?: string;
  children: ReactNode;
}) {
  return (
    <Card withBorder id={id} className={classes.anchorTarget} padding="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md" mb="md">
        <Stack gap={2} style={{ minWidth: 0, flex: "1 1 280px" }}>
          <Title order={4}>{title}</Title>
          <Text size="sm" c="dimmed" component="div">
            {description}
          </Text>
          <Text size="xs" c="dimmed">
            {range.label}
            {rangeNote ? ` · ${rangeNote}` : ""}
          </Text>
        </Stack>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <RangeFilter key={rangeParam(range)} report={id} preset={range.preset} from={range.from} to={range.to} />
          <Button
            component="a"
            href={`/reports/csv/${id}?range=${encodeURIComponent(rangeParam(range))}`}
            download
            size="xs"
            variant="default"
            leftSection={<Download size={14} />}
          >
            CSV
          </Button>
        </Group>
      </Group>
      <Stack gap="lg">{children}</Stack>
    </Card>
  );
}

export function Kpis({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: items.length }} spacing="sm">
      {items.map((k) => (
        <div key={k.label} className={classes.kpi}>
          <Text size="xs" c="dimmed">
            {k.label}
          </Text>
          <Text fw={700} fz={20} lh="28px" component="div">
            {k.value}
          </Text>
          {k.hint && (
            <Text size="xs" c="dimmed" component="div">
              {k.hint}
            </Text>
          )}
        </div>
      ))}
    </SimpleGrid>
  );
}

export type Column<T> = { label: string; render: (row: T) => ReactNode; align?: "left" | "right"; minWidth?: number };

/** A plain report table with an optional bold total row. */
export function DataTable<T>({
  title,
  columns,
  rows,
  rowKey,
  total,
  empty,
}: {
  title?: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  total?: T;
  empty: string;
}) {
  return (
    <Stack gap={6} style={{ minWidth: 0 }}>
      {title && (
        <Text size="sm" fw={700}>
          {title}
        </Text>
      )}
      {rows.length === 0 ? (
        <Empty compact>{empty}</Empty>
      ) : (
        <TableScrollContainer minWidth={columns.length * 96}>
          <Table highlightOnHover withTableBorder>
            <TableThead>
              <TableTr>
                {columns.map((c) => (
                  <TableTh key={c.label} ta={c.align ?? "left"} miw={c.minWidth}>
                    {c.label}
                  </TableTh>
                ))}
              </TableTr>
            </TableThead>
            <TableTbody>
              {rows.map((r, i) => (
                <TableTr key={rowKey(r, i)}>
                  {columns.map((c) => (
                    <TableTd key={c.label} ta={c.align ?? "left"}>
                      {c.render(r)}
                    </TableTd>
                  ))}
                </TableTr>
              ))}
              {total && rows.length > 1 && (
                <TableTr className={classes.totalRow}>
                  {columns.map((c, i) => (
                    <TableTd key={c.label} ta={c.align ?? "left"}>
                      {i === 0 ? "Total" : c.render(total)}
                    </TableTd>
                  ))}
                </TableTr>
              )}
            </TableTbody>
          </Table>
        </TableScrollContainer>
      )}
    </Stack>
  );
}
