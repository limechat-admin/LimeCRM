/** The report cards. Each loads its own data for its own range. */
import { Badge, Grid, GridCol, Stack, Text } from "@mantine/core";
import { AnchorLink } from "@/components/links";
import { Empty, HEALTH_COLOR } from "@/components/ui";
import { LEAD_STATUS_LABEL, LEAD_STATUSES, type LeadStatus } from "@/domain/leads";
import { CHURN_LABEL, DEAL_TYPE_LABEL, inr, LIFECYCLE_LABEL, SEGMENT_LABEL, shortDate } from "@/lib/format";
import { DEAL_CHECKS, LEAD_CHECKS } from "@/domain/hygiene";
import { getCustomerBook, getHygiene, getMrrBooked, getOnboardingThroughput, getFunnel, getPipeline, funnelGroupLabel } from "@/server/reports";
import { DEAL_TYPES, HEALTHS, kickoffToHandover, NO_OWNER, weightedMrr, type BookedLine, type DealType } from "./aggregate";
import { ReportBarChart, type ChartSeries } from "./charts";
import { FUNNEL_CUTS, funnelQuery, type FunnelLine, type FunnelOptions } from "./funnel";
import { FunnelControls } from "./funnel-controls";
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

// ---------- 3. Conversion funnel ----------

const STATUS_ORDER = Object.fromEntries(LEAD_STATUSES.map((s, i) => [s.key, i]));

export async function FunnelCard({ range, options }: { range: DateRange; options: FunnelOptions }) {
  const r = await getFunnel(range, options);
  const cohort = options.cohort === "created";
  const cut = FUNNEL_CUTS.find((c) => c.value === options.by)!.label;
  const sqls = r.totals.sql;
  const groupName = (l: FunnelLine) => funnelGroupLabel(options.by, l.name);
  const bold = (n: number) => (
    <Text fw={700} size="sm">
      {count(n)}
    </Text>
  );
  return (
    <ReportCard
      id="funnel"
      title="Conversion funnel"
      description={
        <>
          How leads move from created to a won deal, with conversion and median days at each step. A lead counts at every step up to the
          furthest it reached, so an SQL with no meeting dates still counts as a meeting. Deal won is the company&apos;s first deal won on or
          after the SQL date. Meeting → SQL is from completed meetings; median days use leads with both dates recorded.
        </>
      }
      range={range}
      rangeNote={cohort ? "leads created in the period, and how far they've got by today" : "by the day each step happened"}
      csvQuery={funnelQuery(options)}
    >
      <FunnelControls report="funnel" options={options} />
      <Kpis
        items={[
          { label: cohort ? "Leads created" : "SQLs", value: count(cohort ? r.totals.lead : sqls), hint: cohort ? undefined : `${count(r.totals.lead)} leads created` },
          { label: "Lead → SQL", value: pct(r.totals.leadToSql), hint: cohort ? plural(sqls, "SQL") : "SQLs ÷ leads created" },
          { label: "SQL → won", value: pct(r.totals.sqlToWon), hint: sqls ? `${count(r.totals.won)} of ${count(sqls)}` : "No SQLs" },
          { label: "Lead → SQL (median)", value: days(r.totals.medianLeadToSql) },
          { label: "Won MRR", value: inr(r.totals.wonMrr), hint: plural(r.totals.won, "lead") + " won" },
        ]}
      />
      {r.rows.length === 0 ? (
        <Empty>{cohort ? "No leads were created in this period" : "No lead reached a funnel step in this period"}</Empty>
      ) : (
        <>
          <Grid gap="lg">
            <GridCol span={{ base: 12, lg: 5 }}>
              <ReportBarChart
                unit="count"
                dataKey="label"
                horizontal
                height={40 + r.steps.length * 40}
                series={[{ name: "count", label: cohort ? "Leads" : "Reached in period", color: SERIES[0] }]}
                data={r.steps.map((st) => ({ label: st.label, count: st.count }))}
              />
            </GridCol>
            <GridCol span={{ base: 12, lg: 7 }}>
              <DataTable
                rows={r.steps}
                rowKey={(st) => st.key}
                empty=""
                columns={[
                  { label: "Step", render: (st) => st.label, minWidth: 150 },
                  { label: "Leads", render: (st) => bold(st.count), align: "right" },
                  { label: "From previous", render: (st) => pct(st.fromPrevious), align: "right" },
                  { label: "From top", render: (st) => pct(st.fromTop), align: "right" },
                  { label: "Median days", render: (st) => (st.medianDays === null ? "—" : st.medianDays), align: "right" },
                ]}
              />
            </GridCol>
          </Grid>
          <DataTable<FunnelLine>
            title={`By ${cut === cut.toUpperCase() ? cut : cut.toLowerCase()}${options.monthly ? " and month" : ""}`}
            rows={r.groups}
            rowKey={(l) => `${l.name}-${l.month}`}
            total={r.totals}
            empty=""
            columns={[
              { label: cut, render: groupName, minWidth: 140 },
              ...(options.monthly ? [{ label: "Month", render: (l: FunnelLine) => (l.month ? monthLabel(l.month) : "") }] : []),
              { label: "Leads", render: (l) => count(l.lead), align: "right" },
              { label: "Scheduled", render: (l) => count(l.scheduled), align: "right" },
              { label: "Completed", render: (l) => count(l.completed), align: "right" },
              { label: "Qualified", render: (l) => count(l.qualified), align: "right" },
              { label: "SQLs", render: (l) => bold(l.sql), align: "right" },
              { label: "Won", render: (l) => count(l.won), align: "right" },
              { label: "Meeting → SQL", render: (l) => pct(l.meetingToSql), align: "right" },
              { label: "SQL → won", render: (l) => pct(l.sqlToWon), align: "right" },
              { label: "Lead → SQL", render: (l) => pct(l.leadToSql), align: "right" },
              { label: "Days to SQL", render: (l) => (l.medianLeadToSql === null ? "—" : l.medianLeadToSql), align: "right" },
              { label: "Won MRR", render: money("wonMrr"), align: "right" },
            ]}
          />
          {options.by === "product" && (
            <Text size="xs" c="dimmed">
              A lead interested in several products counts once under each, so the rows add up to more than the total.
            </Text>
          )}
          {!cohort && (
            <Text size="xs" c="dimmed">
              Each step is counted in the period it happened, whenever the lead was created, so a conversion can pass 100% when earlier leads
              convert in this period.
            </Text>
          )}
          {cohort && (
            <Grid gap="lg">
              <GridCol span={{ base: 12, lg: 5 }}>
                <DataTable
                  title="These leads by status now"
                  rows={[...r.byStatus].sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))}
                  rowKey={(st) => st.status}
                  total={{ status: "", count: r.totals.lead }}
                  empty=""
                  columns={[
                    { label: "Status", render: (st) => LEAD_STATUS_LABEL[st.status as LeadStatus] ?? "No status", minWidth: 160 },
                    { label: "Leads", render: (st) => count(st.count), align: "right" },
                  ]}
                />
              </GridCol>
            </Grid>
          )}
        </>
      )}
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

// ---------- 6. CRM hygiene ----------

/** Score colour: green from 90%, yellow from 75%, red below. */
const scoreColor = (n: number | null) => (n === null ? "gray" : n >= 0.9 ? "green" : n >= 0.75 ? "yellow" : "red");
const ScoreBadge = ({ n }: { n: number | null }) => <Badge color={scoreColor(n)}>{pct(n)}</Badge>;
/** The headline score: the number itself in the score colour. */
const ScoreValue = ({ n }: { n: number | null }) => <Text inherit c={n === null ? "dimmed" : `${scoreColor(n)}.7`}>{pct(n)}</Text>;
const share = (t: { passed: number; total: number }) => (t.total ? t.passed / t.total : null);
const FIX_LIMIT = 30;

export async function HygieneCard({ range }: { range: DateRange }) {
  const r = await getHygiene(range);
  type AeRow = (typeof r.ae.people)[number];
  type SdrRow = (typeof r.sdr.people)[number];
  const toFix = r.ae.team.failing.length + r.sdr.team.failing.length;
  const fixList = (items: typeof r.ae.team.failing, base: string, personLabel: string) => (
    <DataTable
      rows={items.slice(0, FIX_LIMIT)}
      rowKey={(f) => f.id}
      empty="Nothing to fix"
      columns={[
        {
          label: base === "deals" ? "Deal" : "Lead",
          render: (f) => (
            <AnchorLink href={`/${base}/${f.id}`} size="sm" fw={600}>
              {f.title}
            </AnchorLink>
          ),
          minWidth: 200,
        },
        { label: "Company", render: (f) => f.orgName ?? "—", minWidth: 140 },
        { label: personLabel, render: (f) => f.person, minWidth: 120 },
        { label: "To fix", render: (f) => <Text size="sm">{f.problems.join(" · ")}</Text>, minWidth: 260 },
      ]}
    />
  );
  return (
    <ReportCard
      id="hygiene"
      title="CRM hygiene"
      description={
        <>
          How complete and current each person&apos;s records are; 5% of AE variable pay depends on it. AEs: the current stage&apos;s required
          fields, a close date that hasn&apos;t passed, a touch in the last 14 days, a next step and a primary contact. SDRs: the SOP fields for
          the lead&apos;s status and a touch in the last 14 days.
        </>
      }
      range={range}
      rangeNote="open deals and leads as of now, plus those closed in the period"
    >
      <Kpis
        items={[
          { label: "AE hygiene", value: <ScoreValue n={r.ae.team.score} />, hint: plural(r.ae.team.records, "deal") },
          { label: "SDR hygiene", value: <ScoreValue n={r.sdr.team.score} />, hint: plural(r.sdr.team.records, "lead") },
          { label: "Deals to fix", value: count(r.ae.team.failing.length) },
          { label: "Leads to fix", value: count(r.sdr.team.failing.length), hint: toFix ? undefined : "All clean" },
        ]}
      />
      <DataTable<AeRow>
        title="AEs"
        rows={r.ae.people}
        rowKey={(p) => p.personId ?? "none"}
        total={r.ae.team}
        empty="No deals to check"
        columns={[
          { label: "AE", render: (p) => p.name, minWidth: 140 },
          { label: "Score", render: (p) => <ScoreBadge n={p.score} />, align: "right" },
          { label: "Deals", render: (p) => count(p.records), align: "right" },
          ...DEAL_CHECKS.map((c) => ({ label: c.label, render: (p: AeRow) => pct(share(p.byCheck[c.key])), align: "right" as const })),
          { label: "To fix", render: (p) => count(p.failing.length), align: "right" },
        ]}
      />
      <DataTable<SdrRow>
        title="SDRs"
        rows={r.sdr.people}
        rowKey={(p) => p.personId ?? "none"}
        total={r.sdr.team}
        empty="No leads to check"
        columns={[
          { label: "SDR", render: (p) => p.name, minWidth: 140 },
          { label: "Score", render: (p) => <ScoreBadge n={p.score} />, align: "right" },
          { label: "Leads", render: (p) => count(p.records), align: "right" },
          ...LEAD_CHECKS.map((c) => ({ label: c.label, render: (p: SdrRow) => pct(share(p.byCheck[c.key])), align: "right" as const })),
          { label: "To fix", render: (p) => count(p.failing.length), align: "right" },
        ]}
      />
      <Stack gap={6}>
        <Text size="sm" fw={700}>
          Deals to fix{r.ae.team.failing.length > FIX_LIMIT ? ` (the ${FIX_LIMIT} worst of ${count(r.ae.team.failing.length)}; the CSV has every AE)` : ""}
        </Text>
        {fixList(r.ae.team.failing, "deals", "AE")}
      </Stack>
      {r.sdr.team.failing.length > 0 && (
        <Stack gap={6}>
          <Text size="sm" fw={700}>
            Leads to fix
          </Text>
          {fixList(r.sdr.team.failing, "leads", "SDR")}
        </Stack>
      )}
    </ReportCard>
  );
}
