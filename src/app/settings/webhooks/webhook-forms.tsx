"use client";

import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  MultiSelect,
  type MultiSelectProps,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Check, Copy, Webhook } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ALL_EVENTS, WEBHOOK_EVENTS } from "@/domain/webhook-events";
import { createEndpointAction, deleteEndpointAction, type CreateEndpointState } from "./actions";

const EVENT_OPTIONS = [{ value: ALL_EVENTS, label: "All events" }, ...WEBHOOK_EVENTS.map((e) => ({ value: e.key, label: e.label }))];

/** Dropdown rows show the human label with the event key underneath, for whoever writes the receiver. */
const renderEvent: MultiSelectProps["renderOption"] = ({ option }) => (
  <Stack gap={0}>
    <Text size="sm">{option.label}</Text>
    {option.value !== ALL_EVENTS && (
      <Text size="xs" c="dimmed" ff="monospace">
        {option.value}
      </Text>
    )}
  </Stack>
);

/** New-endpoint form. On success it shows the signing secret once, with a copy button. */
export function CreateEndpointForm() {
  const [state, action] = useActionState<CreateEndpointState, FormData>(createEndpointAction, null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>(["deal.stage_changed", "organization.lifecycle_changed", "organization.churned"]);

  if (state?.ok && state.secret && dismissed !== state.secret) {
    const secret = state.secret;
    return (
      <Stack gap="sm">
        <Alert color="lime" variant="light" icon={<Webhook size={18} />} title={`Webhook added: ${state.name}`}>
          Copy the signing secret into the receiving app now. It checks the <Code>X-LimeCRM-Signature</Code> header with it. LimeCRM won&apos;t
          show it again.
        </Alert>
        <Group gap="xs" wrap="nowrap" align="center">
          <Code block style={{ flex: 1, wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
            {secret}
          </Code>
          <CopyButton value={secret}>
            {({ copied, copy }) => (
              <Button variant={copied ? "light" : "filled"} leftSection={copied ? <Check size={16} /> : <Copy size={16} />} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDismissed(secret)}>
            Done
          </Button>
        </Group>
      </Stack>
    );
  }

  // "All events" replaces any specific picks, and picking a specific event drops "All events".
  const pick = (next: string[]) => {
    const added = next.find((v) => !events.includes(v));
    setEvents(added === ALL_EVENTS ? [ALL_EVENTS] : next.filter((v) => v !== ALL_EVENTS));
  };

  return (
    <form action={action}>
      <Stack gap="sm">
        <TextInput name="name" label="Name" placeholder="e.g. AccountPulse, Collections agent" required />
        <TextInput name="url" label="URL" placeholder="https://accountpulse.limechat.ai/hooks/limecrm" required />
        <MultiSelect
          label="Events"
          description="LimeCRM POSTs a signed JSON body for each one."
          data={EVENT_OPTIONS}
          value={events}
          onChange={pick}
          renderOption={renderEvent}
          searchable
          clearable
        />
        <input type="hidden" name="events" value={events.join(",")} />
        {state && !state.ok && (
          <Alert color="red" variant="light">
            {state.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <SubmitButton leftSection={<Webhook size={16} />}>Add webhook</SubmitButton>
        </Group>
      </Stack>
    </form>
  );
}

/** Deleting drops the endpoint and its delivery history, so it asks first. */
export function DeleteEndpointButton({ endpointId, name }: { endpointId: string; name: string }) {
  return (
    <Popover position="bottom-end" width={280} shadow="sm" withArrow>
      <PopoverTarget>
        <Button size="xs" variant="subtle" color="red">
          Delete
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <ActionForm action={deleteEndpointAction}>
          <input type="hidden" name="endpointId" value={endpointId} />
          <Stack gap="xs">
            <Text size="sm">
              Delete <b>{name}</b>? It stops receiving events and its delivery history is removed. Pause it instead to stop it for a while.
            </Text>
            <Group justify="flex-end">
              <SubmitButton size="xs" color="red">
                Delete webhook
              </SubmitButton>
            </Group>
          </Stack>
        </ActionForm>
      </PopoverDropdown>
    </Popover>
  );
}
