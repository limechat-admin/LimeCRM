import { Image, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

/** Full-page message (not found, error) with Limey, in the same voice as the empty states. */
export function StatusScreen({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Stack align="center" justify="center" gap="sm" mih="60vh" ta="center">
      <Image src="/limey-avatar.svg" alt="" w={72} h={72} />
      <Title order={3}>{title}</Title>
      <Text c="dimmed" size="sm" maw={400}>
        {children}
      </Text>
      {actions && <div style={{ marginTop: 8 }}>{actions}</div>}
    </Stack>
  );
}
