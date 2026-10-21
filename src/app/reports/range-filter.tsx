"use client";
/** A report's date-range control. The range lives in the URL (`?<report>=last_month`, or
 *  `?<report>=2026-07-01_2026-09-30` for a custom range) so every view is a shareable link,
 *  and each report on the page keeps its own range. */
import { Button, Group, SegmentedControl } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { DateField } from "@/components/date-field";
import { RANGE_PRESETS, type RangePreset } from "./range";

type Props = { report: string; preset: RangePreset; from: string; to: string };

export function RangeFilter({ report, preset, from, to }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<RangePreset>(preset);
  const [custom, setCustom] = useState({ from, to });

  const go = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(report, value);
    startTransition(() => router.replace(`${pathname}?${next.toString()}#${report}`, { scroll: false }));
  };

  return (
    <Group gap="xs" wrap="wrap" justify="flex-end">
      <SegmentedControl
        size="xs"
        value={mode}
        disabled={pending}
        aria-label="Date range"
        data={RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
        onChange={(v) => {
          setMode(v as RangePreset);
          if (v !== "custom") go(v);
        }}
      />
      {mode === "custom" && (
        <Group gap={6} wrap="nowrap">
          <DateField
            size="xs"
            w={140}
            aria-label="From"
            value={custom.from}
            maxDate={custom.to || undefined}
            onChange={(v) => setCustom({ ...custom, from: v ?? "" })}
          />
          <DateField
            size="xs"
            w={140}
            aria-label="To"
            value={custom.to}
            minDate={custom.from || undefined}
            onChange={(v) => setCustom({ ...custom, to: v ?? "" })}
          />
          <Button size="xs" loading={pending} disabled={!custom.from || !custom.to} onClick={() => go(`${custom.from}_${custom.to}`)}>
            Apply
          </Button>
        </Group>
      )}
    </Group>
  );
}
