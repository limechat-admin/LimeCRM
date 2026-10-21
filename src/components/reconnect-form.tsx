"use client";
/** Company page: when to get back in touch (Salesmate's Reconnect pipeline), with 1/3/6-month presets. */
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { setReconnectAction } from "@/app/actions";
import { RECONNECT_PRESETS, reconnectDateFor } from "@/domain/reconnect";
import { DateField } from "./date-field";
import { ActionForm, SubmitButton } from "./forms";

export function ReconnectForm({ orgId, on, reason, aeName }: { orgId: string; on: string | null; reason: string | null; aeName: string | null }) {
  const [date, setDate] = useState<string | null>(on);
  return (
    <ActionForm action={setReconnectAction}>
      <input type="hidden" name="orgId" value={orgId} />
      <Stack gap="sm">
        <Group gap={6}>
          {RECONNECT_PRESETS.map((p) => (
            <Button key={p.key} size="xs" variant="default" onClick={() => setDate(reconnectDateFor(p.key, new Date()))}>
              {p.label}
            </Button>
          ))}
        </Group>
        <DateField name="reconnectOn" label="Reconnect on" value={date} onChange={setDate} />
        <Textarea name="reconnectReason" label="Why later" placeholder="e.g. Budget frozen till April; revisit after their Shopify move" defaultValue={reason ?? ""} />
        <Text size="xs" c="dimmed">
          {aeName ? `On the day, ${aeName} gets a task to reconnect.` : "Set an AE on the company to get a task on the day."}
        </Text>
        <Group justify="space-between">
          {on ? (
            <Button type="submit" name="clear" value="1" variant="subtle" color="red" size="xs">
              Take off the list
            </Button>
          ) : (
            <span />
          )}
          <SubmitButton disabled={!date}>Save</SubmitButton>
        </Group>
      </Stack>
    </ActionForm>
  );
}
