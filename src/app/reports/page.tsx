import { Button, Group, Stack } from "@mantine/core";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/server/auth";
import { REPORTS, type ReportKey } from "@/server/reports";
import { CustomerBookCard, MrrBookedCard, OnboardingCard, PipelineCard, SdrFunnelCard } from "./cards";
import { parseRange, todayIst } from "./range";

export const metadata: Metadata = { title: "Reports" };

type Search = Partial<Record<ReportKey, string>>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await getCurrentUser();
  const params = await searchParams;
  const today = todayIst();
  const range = (key: ReportKey) => parseRange(params[key], today, REPORTS[key].fallback);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="MRR booked, pipeline, SDR funnel, the customer book and onboarding. Money is INR MRR; every report has its own period and a CSV of the rows behind it."
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
        <SdrFunnelCard range={range("sdr")} />
        <CustomerBookCard range={range("book")} />
        <OnboardingCard range={range("onboarding")} />
      </Stack>
    </>
  );
}
