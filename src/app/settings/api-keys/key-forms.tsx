"use client";

import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Popover,
  PopoverDropdown,
  PopoverTarget,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Check, Copy, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createApiKeyAction, revokeApiKeyAction, type CreateKeyState } from "./actions";

type Option = { value: string; label: string };

/** New-key form. On success it swaps to the key itself, shown once with a copy button. */
export function CreateKeyForm({ users, defaultOwnerId }: { users: Option[]; defaultOwnerId: string }) {
  const [state, action] = useActionState<CreateKeyState, FormData>(createApiKeyAction, null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (state?.ok && state.key && dismissed !== state.key) {
    const key = state.key;
    return (
      <Stack gap="sm">
        <Alert color="lime" variant="light" icon={<KeyRound size={18} />} title={`Key created: ${state.name}`}>
          Copy it now and store it in the app&apos;s secret manager. LimeCRM keeps only a hash, so it can&apos;t show this key again.
        </Alert>
        <Group gap="xs" wrap="nowrap" align="center">
          <Code block style={{ flex: 1, wordBreak: "break-all", whiteSpace: "pre-wrap" }}>
            {key}
          </Code>
          <CopyButton value={key}>
            {({ copied, copy }) => (
              <Button variant={copied ? "light" : "filled"} leftSection={copied ? <Check size={16} /> : <Copy size={16} />} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDismissed(key)}>
            Done
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <form action={action}>
      <Stack gap="sm">
        <TextInput name="name" label="Name" placeholder="e.g. AccountPulse, Collections agent, Claude (Nikhil)" required />
        <Select
          name="ownerId"
          label="Acts as"
          description="Writes are made as this user, with their role's permissions."
          data={users}
          defaultValue={defaultOwnerId}
          searchable
          allowDeselect={false}
          required
        />
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Access
          </Text>
          <SegmentedControl
            name="access"
            defaultValue="read"
            data={[
              { value: "read", label: "Read only" },
              { value: "write", label: "Read and write" },
            ]}
          />
          <Text size="xs" c="dimmed">
            Write lets the key move deals and leads and log activities, never more than its user can.
          </Text>
        </Stack>
        {state && !state.ok && (
          <Alert color="red" variant="light">
            {state.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <SubmitButton leftSection={<KeyRound size={16} />}>Create key</SubmitButton>
        </Group>
      </Stack>
    </form>
  );
}

/** Revoking is immediate and can't be undone, so it asks first. */
export function RevokeKeyButton({ keyId, name }: { keyId: string; name: string }) {
  return (
    <Popover position="bottom-end" width={280} shadow="sm" withArrow>
      <PopoverTarget>
        <Button size="xs" variant="subtle" color="red">
          Revoke
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <ActionForm action={revokeApiKeyAction}>
          <input type="hidden" name="keyId" value={keyId} />
          <Stack gap="xs">
            <Text size="sm">
              Revoke <b>{name}</b>? Anything using it stops working immediately. This can&apos;t be undone.
            </Text>
            <Group justify="flex-end">
              <SubmitButton size="xs" color="red">
                Revoke key
              </SubmitButton>
            </Group>
          </Stack>
        </ActionForm>
      </PopoverDropdown>
    </Popover>
  );
}
