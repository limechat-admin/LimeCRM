import { Button, Group, Stack } from "@mantine/core";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/server/auth";
import { REPORTS, type ReportKey } from "@/server/reports";
import { CustomerBookCard, FunnelCard, HygieneCard, MrrBookedCard, OnboardingCard, PipelineCard } from "./cards";
import { parseFunnelOptions } from "./funnel";
import { parseRange, todayIst } from "./range";

export const metadata: Metadata = { title: "Reports" };

/** Each report's range (`?mrr=last_month`), plus the funnel's own options. */
type Search = Partial<Record<string, string>>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await getCurrentUser();
  const params = await searchParams;
  const today = todayIst();
  const range = (key: ReportKey) => parseRange(params[key], today, REPORTS[key].fallback);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="MRR booked, pipeline, the conversion funnel, the customer book, onboarding and CRM hygiene. Money is INR MRR; every report has its own period and a CSV of the rows behind it."
      />
      <Group gap={6} mb="lg">
        {(Object.keys(REPORTS) as ReportKey[]).map((key) => (
          <Button key={key} component="a" href={`#${key}`} size="xs" variant="default">
            {REPORTS[key].title}
          </Button>
        ))}
      </Group>
      <Stack gap="lg">
        <MrrBookedCard range={range("mrr")} />
        <PipelineCard range={range("pipeline")} />
        <FunnelCard range={range("funnel")} options={parseFunnelOptions((k) => params[k])} />
        <CustomerBookCard range={range("book")} />
        <OnboardingCard range={range("onboarding")} />
        <HygieneCard range={range("hygiene")} />
      </Stack>
    </>
  );
}
