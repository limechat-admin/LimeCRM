"use client";
/** The funnel's cohort mode, group-by and month split. Like the range, they live in the URL
 *  (`?funnelCohort=events&funnelBy=source&funnelMonthly=1`) so every view is a shareable link. */
import { Group, SegmentedControl, Select, Switch } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FUNNEL_COHORTS, FUNNEL_CUTS, FUNNEL_PARAMS, type FunnelOptions } from "./funnel";

export function FunnelControls({ report, options }: { report: string; options: FunnelOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (name: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(name);
    else next.set(name, value);
    startTransition(() => router.replace(`${pathname}?${next.toString()}#${report}`, { scroll: false }));
  };

  return (
    <Group gap="sm" wrap="wrap" align="center">
      <SegmentedControl
        size="xs"
        value={options.cohort}
        disabled={pending}
        aria-label="Count"
        data={FUNNEL_COHORTS.map((c) => ({ value: c.value, label: c.label }))}
        onChange={(v) => set(FUNNEL_PARAMS.cohort, v === "created" ? null : v)}
      />
      <Select
        size="xs"
        w={170}
        aria-label="Group by"
        disabled={pending}
        allowDeselect={false}
        value={options.by}
        data={FUNNEL_CUTS.map((c) => ({ value: c.value, label: `By ${c.label === c.label.toUpperCase() ? c.label : c.label.toLowerCase()}` }))}
        onChange={(v) => v && set(FUNNEL_PARAMS.by, v === "sdr" ? null : v)}
      />
      {options.by !== "month" && (
        <Switch
          size="xs"
          label="Split by month"
          disabled={pending}
          checked={options.monthly}
          onChange={(e) => set(FUNNEL_PARAMS.monthly, e.currentTarget.checked ? "1" : null)}
        />
      )}
    </Group>
  );
}
