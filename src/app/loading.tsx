import { Group, Skeleton, Stack } from "@mantine/core";

/** Shown while a page's data loads: the page header, metric cards and a list, in skeleton form. */
export default function Loading() {
  return (
    <Stack gap="lg" aria-busy aria-label="Loading">
      <Stack gap={6}>
        <Skeleton h={32} w={220} maw="100%" />
        <Skeleton h={16} w={360} maw="100%" />
      </Stack>
      <Group grow>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={72} />
        ))}
      </Group>
      <Skeleton h={320} />
    </Stack>
  );
}
