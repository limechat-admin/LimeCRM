"use client";
/** List filters. Saving re-runs the page, which shows how many people match and who they are. */
import { Button, Card, Group, MultiSelect, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DateField } from "@/components/date-field";
import type { ListFilters } from "@/domain/campaigns";
import { saveListAction } from "../../actions";

type Option = { value: string; label: string };
export type FilterOptions = Record<"leadStatuses" | "users" | "sources" | "products" | "lifecycles" | "segments" | "industries" | "trafficBands", Option[]>;

export function ListEditor({
  id,
  name: initialName,
  filters: initial,
  options,
}: {
  id: string | null;
  name: string;
  filters: ListFilters;
  options: FilterOptions;
}) {
  const [name, setName] = useState(initialName);
  const [f, setF] = useState<ListFilters>(initial);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pick = (key: keyof ListFilters, label: string, data: Option[], help?: string) => (
    <MultiSelect
      label={label}
      description={help}
      data={data}
      value={f[key] as string[]}
      onChange={(v) => setF({ ...f, [key]: v })}
      searchable
      clearable
      placeholder="Any"
    />
  );
  const save = () =>
    start(async () => {
      const res = await saveListAction(id, name, f);
      notifications.show({ color: res.ok ? "lime" : "red", message: res.message ?? "" });
      if (res.ok && res.id) {
        if (!id) router.push(`/campaigns/lists/${res.id}`);
        else router.refresh();
      }
    });
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group align="flex-end" wrap="wrap">
          <TextInput label="List name" value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1, minWidth: 220 }} required />
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              Who
            </Text>
            <SegmentedControl
              value={f.audience}
              onChange={(v) => setF({ ...f, audience: v as ListFilters["audience"] })}
              data={[
                { value: "leads", label: "Leads only" },
                { value: "contacts", label: "Everyone with an email" },
              ]}
            />
          </Stack>
        </Group>
        <Text size="xs" c="dimmed">
          Empty filters match everyone. Within a filter, any value matches; across filters, all must match.
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {pick("leadStatuses", "Lead status", options.leadStatuses)}
          {pick("sources", "Source", options.sources)}
          {pick("sdrIds", "SDR", options.users, "The lead's SDR")}
          {pick("ownerIds", "AE", options.users, "The lead's AE, or the company's")}
          {pick("products", "Product interest", options.products)}
          {pick("lifecycles", "Company lifecycle", options.lifecycles)}
          {pick("segments", "Segment", options.segments)}
          {pick("industries", "Industry", options.industries)}
          {pick("trafficBands", "Website traffic", options.trafficBands)}
          <DateField
            label="Reconnect due by"
            description="Companies on the Reconnect list due on or before"
            value={f.reconnectDueBy}
            onChange={(v) => setF({ ...f, reconnectDueBy: v })}
          />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button onClick={save} loading={pending}>
            {id ? "Save and refresh count" : "Create list"}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
