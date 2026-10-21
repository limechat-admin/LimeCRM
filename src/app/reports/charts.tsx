"use client";
/** Report charts: @mantine/charts (Recharts) bar charts themed from the LimeChat tokens.
 *  Client-only because the value formatters are functions. Series colours come from
 *  reports.module.css (`--rc-1`… in fixed order), never from the data. */
import "@mantine/charts/styles.css";
import { BarChart } from "@mantine/charts";
import { inr, inrCompact } from "@/lib/format";
import classes from "./reports.module.css";

export type ChartSeries = { name: string; label: string; color: string };

type Props = {
  data: Record<string, string | number | null>[];
  dataKey: string;
  series: ChartSeries[];
  /** "money" formats as INR (compact on the axis), "count" as whole numbers. */
  unit: "money" | "count";
  type?: "default" | "stacked";
  /** Horizontal bars, for categories with long names (stages). */
  horizontal?: boolean;
  /** Show the legend even for one series, when the series is a breakdown (deal type, health). */
  legend?: boolean;
  height?: number;
};

const countFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function ReportBarChart({ data, dataKey, series, unit, type = "default", horizontal = false, legend, height = 240 }: Props) {
  const valueAxis = { tickFormatter: unit === "money" ? inrCompact : countFmt, allowDecimals: false };
  const end = type === "stacked" ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  return (
    <div className={classes.chart}>
      <BarChart
        h={height}
        data={data}
        dataKey={dataKey}
        series={series}
        type={type}
        orientation={horizontal ? "vertical" : "horizontal"}
        withLegend={legend ?? series.length > 1}
        // Keep the series order (Recharts sorts the legend alphabetically by default).
        legendProps={{ verticalAlign: "bottom", height: 32, itemSorter: null }}
        gridAxis={horizontal ? "y" : "x"}
        tickLine="none"
        strokeDasharray="0"
        maxBarWidth={40}
        valueFormatter={unit === "money" ? (n) => inr(n) : countFmt}
        xAxisProps={horizontal ? valueAxis : { interval: 0 }}
        yAxisProps={horizontal ? { width: 150, interval: 0 } : { ...valueAxis, width: unit === "money" ? 64 : 32 }}
        // 4px rounded data ends; a 2px surface gap between stacked segments and adjacent bars.
        barProps={{ radius: end as [number, number, number, number] | number, stroke: "var(--mantine-color-body)", strokeWidth: 2 }}
        barChartProps={{ barGap: 2 }}
        tooltipAnimationDuration={150}
      />
    </div>
  );
}
