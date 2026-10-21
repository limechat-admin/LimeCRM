/** The five Reports v1 cards. Each loads its own data for its own range. */
import { Badge, Grid, GridCol, Text } from "@mantine/core";
import { AnchorLink } from "@/components/links";
import { Empty, HEALTH_COLOR } from "@/components/ui";
import { LEAD_STATUS_LABEL, LEAD_STATUSES, type LeadStatus } from "@/domain/leads";
import { CHURN_LABEL, DEAL_TYPE_LABEL, inr, LIFECYCLE_LABEL, SEGMENT_LABEL, shortDate } from "@/lib/format";
import { getCustomerBook, getMrrBooked, getOnboardingThroughput, getPipeline, getSdrFunnel } from "@/server/reports";
import { DEAL_TYPES, HEALTHS, kickoffToHandover, NO_OWNER, weightedMrr, type BookedLine, type DealType } from "./aggregate";
import { ReportBarChart, type ChartSeries } from "./charts";
import { inRange, monthLabel, type DateRange } from "./range";
import { DataTable, Kpis, ReportCard, type Column } from "./report-ui";

/** Categorical colours in fixed order; an entity keeps its colour whatever else is on the chart. */
const SERIES = ["var(--rc-1)", "var(--rc-2)", "var(--rc-3)", "var(--rc-4)", "var(--rc-5)"];
const TYPE_COLOR = Object.fromEntries(DEAL_TYPES.map((t, i) => [t, SERIES[i]])) as Record<DealType, string>;

const count = (n: number) => n.toLocaleString("en-IN");
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const days = (n: number | null) => (n === null ? "—" : `${n} ${n === 1 ? "day" : "days"}`);
const segmentLabel = (s: string) => SEGMENT_LABEL[s as keyof typeof SEGMENT_LABEL] ?? "No segment";
const money = (key: string) => (r: Record<string, unknown>) => inr(r[key] as number);

// ---------- 1. MRR booked ----------

export async function MrrBookedCard({ range }: { range: DateRange }) {
  const r = await getMrrBooked(range);
  const types = r.types.length ? r.types : DEAL_TYPES.slice(0, 4);
  const multiMonth = r.byMonth.length > 1;
  const series: ChartSeries[] = types.map((t) => ({ name: t, label: DEAL_TYPE_LABEL[t], color: TYPE_COLOR[t] }));
  const columns = (first: string, name: (l: BookedLine) => string): Column<BookedLine>[] => [
    { label: first, render: name, minWidth: 140 },
    { label: "Won", render: (l) => count(l.count), align: "right" },
    ...types.map((t) => ({ label: DEAL_TYPE_LABEL[t], render: money(t), align: "right" as const })),
    { label: "MRR", render: (l) => <Text fw={700} size="sm">{inr(l.total)}</Text>, align: "right" },
    { label: "One-time", render: money("oneTime"), align: "right" },
  ];
  return (
    <ReportCard
      id="mrr"
      title="MRR booked"
      description="MRR from deals won in the period, by deal type, AE and month, plus one-time revenue (implementation and other one-off fees)."
      range={range}
      rangeNote="by won date"
    >
      <Kpis
        items={[
          { label: "MRR booked", value: inr(r.totals.total) },
          { label: "One-time revenue", value: inr(r.totals.oneTime) },
          { label: "Deals won", value: count(r.totals.count) },
          { label: "Average MRR per deal", value: r.totals.count ? inr(r.totals.total / r.totals.count) : "—" },
        ]}
      />
      {r.rows.length === 0 ? (
        <Empty>No deals were won in this period</Empty>
      ) : (
        <>
          <ReportBarChart
            type="stacked"
            unit="money"
            dataKey="label"
            legend
            series={series}
            data={(multiMonth ? r.byMonth.map((m) => ({ ...m, label: monthLabel(m.name) })) : r.byOwner.map((o) => ({ ...o, label: o.name })))}
          />
          <DataTable title="By AE" columns={columns("AE", (l) => l.name)} rows={r.byOwner} rowKey={(l) => l.name} total={r.totals} empty="" />
          {multiMonth && (
            <DataTable title="By month" columns={columns("Month", (l) => monthLabel(l.name))} rows={r.byMonth} rowKey={(l) => l.name} total={r.totals} empty="" />
          )}
          {r.usdDeals > 0 && (
            <Text size="xs" c="dimmed">
              {r.usdDeals} USD {r.usdDeals === 1 ? "deal is" : "deals are"} included at face value: LimeCRM doesn&apos;t store an exchange rate yet.
            </Text>
          )}
        </>
      )}
    </ReportCard>
  );
}

// ---------- 2. Pipeline & forecast ----------

export async function PipelineCard({ range }: { range: DateRange }) {
  const r = await getPipeline(range);
  type Line = (typeof r.byOwner)[number];
  return (
    <ReportCard
      id="pipeline"
      title="Pipeline and forecast"
      description="Every open deal by stage and AE, weighted by stage win probability. Commit is the MRR expected to close in the period from deals at Commercial Discussion or later."
      range={range}
      rangeNote="by expected close date (closing and commit only)"
    >
      <Kpis
        items={[
          { label: "Open pipeline", value: inr(r.totals.total), hint: plural(r.totals.count, "open deal") },
          { label: "Weighted pipeline", value: inr(r.totals.weighted) },
          { label: "Closing in period", value: inr(r.totals.closing) },
          { label: "Commit", value: inr(r.totals.commit), hint: plural(r.commitDeals.length, "deal") },
        ]}
      />
      {r.rows.length === 0 ? (
        <Empty>No open deals</Empty>
      ) : (
        <>
          <ReportBarChart
            unit="money"
            dataKey="name"
            horizontal
            height={40 + r.byStage.length * 44}
            series={[
              { name: "total", label: "Open MRR", color: SERIES[0] },
              { name: "weighted", label: "Weighted MRR", color: SERIES[1] },
            ]}
            data={r.byStage}
          />
          <Grid gap="lg">
            <GridCol span={{ base: 12, xl: 5 }}>
              <DataTable
                title="By stage"
                rows={r.byStage}
                rowKey={(s) => s.name}
                total={{ ...r.totals, winProbability: null }}
                empty=""
                columns={[
                  { label: "Stage", render: (s) => s.name, minWidth: 160 },
                  { label: "Win %", render: (s) => (s.winProbability === null ? "" : `${s.winProbability}%`), align: "right" },
                  { label: "Deals", render: (s) => count(s.count), align: "right" },
                  { label: "MRR", render: money("total"), align: "right" },
                  { label: "Weighted", render: money("weighted"), align: "right" },
                ]}
              />
            </GridCol>
            <GridCol span={{ base: 12, xl: 7 }}>
              <DataTable<Line>
                title="By AE"
                rows={r.byOwner}
                rowKey={(l) => l.name}
                total={r.totals}
                empty=""
                columns={[
                  { label: "AE", render: (l) => l.name, minWidth: 140 },
                  { label: "Deals", render: (l) => count(l.count), align: "right" },
                  { label: "Open MRR", render: money("total"), align: "right" },
                  { label: "Weighted", render: money("weighted"), align: "right" },
                  { label: "Closing", render: money("closing"), align: "right" },
                  { label: "Commit", render: (l) => <Text fw={700} size="sm">{inr(l.commit)}</Text>, align: "right" },
                ]}
              />
            </GridCol>
          </Grid>
          <DataTable
            title="Commit deals"
            rows={r.commitDeals}
            rowKey={(d) => d.id}
            empty="No deals at Commercial Discussion or later are expected to close in this period"
            columns={[
              { label: "Deal", render: (d) => <AnchorLink href={`/deals/${d.id}`} size="sm">{d.title}</AnchorLink>, minWidth: 220 },
              { label: "AE", render: (d) => d.ownerName ?? NO_OWNER },
              { label: "Stage", render: (d) => d.stageName },
              { label: "Expected close", render: (d) => shortDate(d.expectedCloseDate) },
              { label: "MRR", render: (d) => inr(d.mrr), align: "right" },
              { label: "Weighted", render: (d) => inr(weightedMrr(d)), align: "right" },
            ]}
          />
          {r.noCloseDate > 0 && (
            <Text size="xs" c="dimmed">
              {r.noCloseDate} open {r.noCloseDate === 1 ? "deal has" : "deals have"} no expected close date, so {r.noCloseDate === 1 ? "it can't" : "they can't"} be forecast.
            </Text>
          )}
        </>
      )}
    </ReportCard>
  );
}

// ---------- 3. SDR funnel ----------

const STATUS_ORDER = Object.fromEntries(LEAD_STATUSES.map((s, i) => [s.key, i]));

export async function SdrFunnelCard({ range }: { range: DateRange }) {
  const r = await getSdrFunnel(range);
  const any = r.totals.scheduled + r.totals.completed + r.totals.qualified + r.totals.sqls > 0;
  type Cell = (typeof r.bySdrMonth)[number];
  return (
    <ReportCard
      id="sdr"
      title="SDR funnel"
      description="Meetings, qualified meetings and SQLs per SDR, counted on the day each happened, and how many of the period's SQLs have since been won."
      range={range}
    >
      <Kpis
        items={[
          { label: "Meetings scheduled", value: count(r.totals.scheduled) },
          { label: "Meetings completed", value: count(r.totals.completed) },
          { label: "Qualified meetings", value: count(r.totals.qualified) },
          { label: "SQLs", value: count(r.totals.sqls) },
          {
            label: "SQL → won",
            value: pct(r.conversion.rate),
            hint: r.conversion.sqls ? `${r.conversion.won} of ${r.conversion.sqls} · ${inr(r.conversion.wonMrr)} MRR` : "No SQLs in period",
          },
        ]}
      />
      {any && (
        <ReportBarChart
          unit="count"
          dataKey="label"
          series={[
            { name: "scheduled", label: "Meetings scheduled", color: SERIES[0] },
            { name: "completed", label: "Meetings completed", color: SERIES[1] },
            { name: "qualified", label: "Qualified meetings", color: SERIES[2] },
            { name: "sqls", label: "SQLs", color: SERIES[3] },
          ]}
          data={r.byMonth.map((m) => ({ ...m, label: monthLabel(m.name) }))}
        />
      )}
      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 8 }}>
          <DataTable<Cell>
            title="Per SDR per month"
            rows={r.bySdrMonth}
            rowKey={(c) => `${c.sdr}-${c.month}`}
            empty="No meetings or SQLs in this period"
            columns={[
              { label: "SDR", render: (c) => c.sdr, minWidth: 140 },
              { label: "Month", render: (c) => monthLabel(c.month) },
              { label: "Scheduled", render: (c) => count(c.scheduled), align: "right" },
              { label: "Completed", render: (c) => count(c.completed), align: "right" },
              { label: "Qualified", render: (c) => count(c.qualified), align: "right" },
              { label: "SQLs", render: (c) => <Text fw={700} size="sm">{count(c.sqls)}</Text>, align: "right" },
            ]}
          />
        </GridCol>
        <GridCol span={{ base: 12, lg: 4 }}>
          <DataTable
            title={`Leads created (${count(r.created)}) by status now`}
            rows={[...r.byStatus].sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))}
            rowKey={(s) => s.status}
            total={{ status: "", count: r.created }}
            empty="No leads created in this period"
            columns={[
              { label: "Status", render: (s) => LEAD_STATUS_LABEL[s.status as LeadStatus] ?? "No status", minWidth: 160 },
              { label: "Leads", render: (s) => count(s.count), align: "right" },
            ]}
          />
        </GridCol>
      </Grid>
    </ReportCard>
  );
}

// ---------- 4. Customer book ----------

const HEALTH_LABEL: Record<(typeof HEALTHS)[number], string> = { green: "Green", yellow: "Yellow", red: "Red", none: "Not set" };
const HEALTH_SERIES: ChartSeries[] = HEALTHS.map((h) => ({
  name: h,
  label: HEALTH_LABEL[h],
  color: h === "none" ? "var(--rc-neutral)" : `${HEALTH_COLOR[h]}.6`,
}));

export async function CustomerBookCard({ range }: { range: DateRange }) {
  const { book, churn } = await getCustomerBook(range);
  const [active, onboarding, onHold] = book.byLifecycle;
  type Line = (typeof book.byCsm)[number];
  type ChurnLine = (typeof churn.byMonth)[number];
  return (
    <ReportCard
      id="book"
      title="Customer book"
      description="Today's active, onboarding and on-hold customers with contracted MRR by CSM, segment and health, and the MRR lost to churn in the period."
      range={range}
      rangeNote="applies to churn; the book is as of today"
    >
      <Kpis
        items={[
          { label: "Customers", value: count(book.totals.count), hint: `${inr(book.totals.total)} contracted MRR` },
          { label: LIFECYCLE_LABEL.active, value: count(active.count), hint: inr(active.total) },
          { label: LIFECYCLE_LABEL.onboarding, value: count(onboarding.count), hint: inr(onboarding.total) },
          { label: LIFECYCLE_LABEL.on_hold, value: count(onHold.count), hint: inr(onHold.total) },
        ]}
      />
      {book.rows.length === 0 ? (
        <Empty>No customers yet</Empty>
      ) : (
        <>
          <ReportBarChart type="stacked" unit="money" dataKey="name" horizontal legend series={HEALTH_SERIES} data={book.byCsm} height={72 + book.byCsm.length * 40} />
          <Grid gap="lg">
            <GridCol span={{ base: 12, xl: 7 }}>
              <DataTable<Line>
                title="By CSM and health"
                rows={book.byCsm}
                rowKey={(l) => l.name}
                total={book.totals}
                empty=""
                columns={[
                  { label: "CSM", render: (l) => l.name, minWidth: 140 },
                  { label: "Accounts", render: (l) => count(l.count), align: "right" },
                  { label: "MRR", render: (l) => <Text fw={700} size="sm">{inr(l.total)}</Text>, align: "right" },
                  ...HEALTHS.map((h) => ({ label: HEALTH_LABEL[h], render: money(h), align: "right" as const })),
                ]}
              />
            </GridCol>
            <GridCol span={{ base: 12, xl: 5 }}>
              <DataTable<Line>
                title="By segment"
                rows={book.bySegment}
                rowKey={(l) => l.name}
                total={book.totals}
                empty=""
                columns={[
                  { label: "Segment", render: (l) => segmentLabel(l.name), minWidth: 160 },
                  { label: "Accounts", render: (l) => count(l.count), align: "right" },
                  { label: "MRR", render: money("total"), align: "right" },
                ]}
              />
            </GridCol>
          </Grid>
          <Text size="xs" c="dimmed" component="div">
            Health:{" "}
            {book.byHealth.map((h) => (
              <Badge key={h.health} mr={6} color={h.health === "none" ? "gray" : HEALTH_COLOR[h.health]}>
                {HEALTH_LABEL[h.health]} {h.count}
              </Badge>
            ))}
          </Text>
        </>
      )}

      <Kpis
        items={[
          { label: "Churned customers", value: count(churn.totals.count) },
          { label: "Churned MRR", value: inr(churn.totals.total) },
        ]}
      />
      {churn.rows.length === 0 ? (
        <Empty compact>No customers churned in this period</Empty>
      ) : (
        <Grid gap="lg">
          <GridCol span={{ base: 12, lg: 6 }}>
            <DataTable<ChurnLine>
              title="Churn by category"
              rows={churn.byCategory}
              rowKey={(l) => l.name}
              total={churn.totals}
              empty=""
              columns={[
                { label: "Category", render: (l) => CHURN_LABEL[l.name as keyof typeof CHURN_LABEL] ?? "Not categorised", minWidth: 180 },
                { label: "Customers", render: (l) => count(l.count), align: "right" },
                { label: "MRR", render: money("total"), align: "right" },
              ]}
            />
          </GridCol>
          <GridCol span={{ base: 12, lg: 6 }}>
            <DataTable<ChurnLine>
              title="Churn by month"
              rows={churn.byMonth}
              rowKey={(l) => l.name}
              total={churn.totals}
              empty=""
              columns={[
                { label: "Month", render: (l) => monthLabel(l.name), minWidth: 120 },
                { label: "Customers", render: (l) => count(l.count), align: "right" },
                { label: "MRR", render: money("total"), align: "right" },
              ]}
            />
          </GridCol>
        </Grid>
      )}
    </ReportCard>
  );
}

// ---------- 5. Onboarding throughput ----------

export async function OnboardingCard({ range }: { range: DateRange }) {
  const r = await getOnboardingThroughput(range);
  const handed = r.rows.filter((o) => inRange(o.handedOn, range)).sort((a, b) => a.handedOn!.localeCompare(b.handedOn!));
  type Line = (typeof r.byOm)[number];
  return (
    <ReportCard
      id="onboarding"
      title="Onboarding throughput"
      description="Onboardings opened and handed to CS in the period, and the average days from kick-off to handover. Stage dates come from the audit log."
      range={range}
    >
      <Kpis
        items={[
          { label: "Opened", value: count(r.totals.opened) },
          { label: "Handed to CS", value: count(r.totals.handed) },
          {
            label: "Kick-off → CS (average)",
            value: days(r.totals.avgDays),
            hint: r.totals.handed ? `over ${r.totals.timed} of ${r.totals.handed} handovers with a kick-off date` : undefined,
          },
        ]}
      />
      {r.totals.opened + r.totals.handed === 0 ? (
        <Empty>No onboardings opened or handed to CS in this period</Empty>
      ) : (
        <>
          <ReportBarChart
            unit="count"
            dataKey="label"
            series={[
              { name: "opened", label: "Opened", color: SERIES[0] },
              { name: "handed", label: "Handed to CS", color: SERIES[1] },
            ]}
            data={r.byMonth.map((m) => ({ ...m, label: monthLabel(m.name) }))}
            height={200}
          />
          <Grid gap="lg">
            <GridCol span={{ base: 12, lg: 5 }}>
              <DataTable<Line>
                title="By onboarding manager"
                rows={r.byOm}
                rowKey={(l) => l.name}
                total={r.totals}
                empty=""
                columns={[
                  { label: "Onboarding manager", render: (l) => l.name, minWidth: 160 },
                  { label: "Opened", render: (l) => count(l.opened), align: "right" },
                  { label: "Handed", render: (l) => count(l.handed), align: "right" },
                  { label: "Avg days", render: (l) => (l.avgDays === null ? "—" : l.avgDays), align: "right" },
                ]}
              />
            </GridCol>
            <GridCol span={{ base: 12, lg: 7 }}>
              <DataTable
                title="Handed to CS"
                rows={handed}
                rowKey={(o) => o.id}
                empty="Nothing was handed to CS in this period"
                columns={[
                  { label: "Company", render: (o) => o.orgName, minWidth: 160 },
                  { label: "Onboarding manager", render: (o) => o.omName ?? NO_OWNER },
                  { label: "Kick-off", render: (o) => shortDate(o.kickoffOn) },
                  { label: "Handed", render: (o) => shortDate(o.handedOn) },
                  {
                    label: "Days",
                    render: (o) => kickoffToHandover(o) ?? "—",
                    align: "right",
                  },
                ]}
              />
            </GridCol>
          </Grid>
        </>
      )}
    </ReportCard>
  );
}
