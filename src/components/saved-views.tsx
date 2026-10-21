"use client";
/** "Save view" popover for list pages. */
import { Button, Checkbox, Popover, Stack, TextInput } from "@mantine/core";
import { BookmarkPlus } from "lucide-react";
import { useState } from "react";
import { saveViewAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "./forms";

export function SaveViewButton({ module, query, canShare }: { module: string; query: string; canShare: boolean }) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={280} shadow="sm" trapFocus>
      <Popover.Target>
        <Button variant="default" size="xs" leftSection={<BookmarkPlus size={14} />} onClick={() => setOpened((o) => !o)}>
          Save view
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <ActionForm action={saveViewAction}>
          <input type="hidden" name="module" value={module} />
          <input type="hidden" name="query" value={query} />
          <Stack gap="sm">
            <TextInput name="name" label="View name" placeholder="e.g. My SQLs this month" required maxLength={60} data-autofocus />
            {canShare && <Checkbox name="shared" label="Share with the team" />}
            <SubmitButton size="xs">Save</SubmitButton>
          </Stack>
        </ActionForm>
      </Popover.Dropdown>
    </Popover>
  );
}
