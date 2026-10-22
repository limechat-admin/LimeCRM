"use client";
/** Small popover forms for editing one picklist value (rename, retire, map an off-list value). */
import { Button, Group, Popover, PopoverDropdown, PopoverTarget, Select, Stack, Text, TextInput } from "@mantine/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { mapValueAction, renameOptionAction, retireOptionAction } from "./actions";

export function RenameOption({ field, value }: { field: string; value: string }) {
  return (
    <Popover position="bottom-end" width={300} shadow="sm" withArrow>
      <PopoverTarget>
        <Button size="compact-xs" variant="subtle">
          Rename
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <ActionForm action={renameOptionAction}>
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="value" value={value} />
          <Stack gap="xs">
            <TextInput name="to" label="New name" defaultValue={value} required data-autofocus />
            <Text size="xs" c="dimmed">
              Every record using &quot;{value}&quot; changes too.
            </Text>
            <Group justify="flex-end">
              <SubmitButton size="xs">Rename</SubmitButton>
            </Group>
          </Stack>
        </ActionForm>
      </PopoverDropdown>
    </Popover>
  );
}

export function RetireOption({ field, value, others, used }: { field: string; value: string; others: string[]; used: number }) {
  return (
    <Popover position="bottom-end" width={320} shadow="sm" withArrow>
      <PopoverTarget>
        <Button size="compact-xs" variant="subtle" color="red">
          Retire
        </Button>
      </PopoverTarget>
      <PopoverDropdown>
        <ActionForm action={retireOptionAction}>
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="value" value={value} />
          <Stack gap="xs">
            <Text size="sm">
              Stop offering <b>{value}</b>.
            </Text>
            <Select
              name="replaceWith"
              label={`Move its ${used} ${used === 1 ? "record" : "records"} to`}
              placeholder="Keep it on those records"
              clearable
              searchable
              data={others}
            />
            <Text size="xs" c="dimmed">
              Without a replacement it stays valid on existing records but can&apos;t be picked for new ones.
            </Text>
            <Group justify="flex-end">
              <SubmitButton size="xs" color="red">
                Retire
              </SubmitButton>
            </Group>
          </Stack>
        </ActionForm>
      </PopoverDropdown>
    </Popover>
  );
}

/** An off-list value on records: change it to a listed value, or clear it. */
export function MapValue({ field, value, options, suggestion }: { field: string; value: string; options: string[]; suggestion: string | null }) {
  return (
    <ActionForm action={mapValueAction}>
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={value} />
      <Group gap={6} wrap="nowrap" justify="flex-end">
        <Select
          name="to"
          size="xs"
          w={200}
          defaultValue={suggestion}
          placeholder="Change to…"
          searchable
          data={[...options, { value: "__clear", label: "Clear it (leave empty)" }]}
          aria-label={`Change ${value} to`}
        />
        <SubmitButton size="xs" variant="default">
          Apply
        </SubmitButton>
      </Group>
    </ActionForm>
  );
}
