"use client";
/** "Merge into …": folds one duplicate into the record you keep, after a confirmation. */
import { Button, Group, Popover, PopoverDropdown, PopoverTarget, Select, Stack, Text } from "@mantine/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { mergeAction } from "./actions";

export function MergeButton({
  kind,
  drop,
  keepOptions,
}: {
  kind: "company" | "contact";
  drop: { id: string; name: string };
  keepOptions: { value: string; label: string }[];
}) {
  return (
    <Popover position="bottom-end" width={340} shadow="sm" withArrow>
      <PopoverTarget>
        <Button size="compact-xs" variant="subtle">
          Merge…
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <ActionForm action={mergeAction}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="dropId" value={drop.id} />
          <Stack gap="xs">
            <Select name="keepId" label={`Merge ${drop.name} into`} data={keepOptions} defaultValue={keepOptions[0]?.value} allowDeselect={false} />
            <Text size="xs" c="dimmed">
              {kind === "company"
                ? "Its deals, contacts, activities and history move to the company you keep; empty fields there are filled from it. Then it's deleted."
                : "Their activities and deal links move to the person you keep; empty fields there are filled. Then this record is deleted."}{" "}
              This can&apos;t be undone.
            </Text>
            <Group justify="flex-end">
              <SubmitButton size="xs">Merge</SubmitButton>
            </Group>
          </Stack>
        </ActionForm>
      </PopoverDropdown>
    </Popover>
  );
}
