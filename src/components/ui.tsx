import { Badge, Card, Group, Image, Stack, Text, Title, type MantineColor } from "@mantine/core";
import type { ReactNode } from "react";

/** Page title + one-line description, as on every LimeNotes page. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="lg" wrap="wrap" gap="md">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Title order={2}>{title}</Title>
        {subtitle && (
          <Text c="dimmed" size="sm" component="div">
            {subtitle}
          </Text>
        )}
      </Stack>
      {actions}
    </Group>
  );
}

/** A titled card (Figma Card: 4px radius, sm shadow, 1px default border). */
export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card withBorder>
      {(title || actions) && (
        <Group justify="space-between" mb="sm" wrap="nowrap" gap="sm">
          {title && <Title order={5}>{title}</Title>}
          {actions}
        </Group>
      )}
      {children}
    </Card>
  );
}

export function Stat({ label, value, align = "left" }: { label: string; value: ReactNode; align?: "left" | "right" }) {
  return (
    <Stack gap={0} align={align === "right" ? "flex-end" : "flex-start"}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={600} component="div">
        {value}
      </Text>
    </Stack>
  );
}

/** Big-number tile, as on the LimeNotes admin page. */
export function MetricCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  // Long figures (₹2,19,99,539) shrink to fit the card's width (container units) instead of wrapping;
  // short ones stay at 24px. A digit is about 0.6em wide in Lato bold.
  const chars = typeof value === "string" || typeof value === "number" ? String(value).length : 8;
  return (
    <Card withBorder style={{ containerType: "inline-size" }}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} lh="32px" style={{ fontSize: `clamp(14px, ${(150 / Math.max(chars, 1)).toFixed(1)}cqi, 24px)`, whiteSpace: "nowrap" }}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

const LIFECYCLE_COLOR: Record<string, MantineColor> = {
  prospect: "gray",
  onboarding: "lime",
  active: "green",
  on_hold: "yellow",
  churned: "red",
};

const STATUS_COLOR: Record<string, MantineColor> = { open: "gray", won: "green", lost: "red" };

export function LifecycleBadge({ lifecycle, label }: { lifecycle: string; label: string }) {
  return <Badge color={LIFECYCLE_COLOR[lifecycle] ?? "gray"}>{label}</Badge>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge color={STATUS_COLOR[status] ?? "gray"}>{label ?? status}</Badge>;
}

export const HEALTH_COLOR: Record<string, MantineColor> = { green: "green", yellow: "yellow", red: "red" };

/** Empty state with Limey: one short, plain line. */
export function Empty({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <Stack align="center" gap="xs" py={compact ? "sm" : "lg"}>
      {!compact && <Image src="/limey-avatar.svg" alt="" w={40} h={40} />}
      <Text size="sm" c="dimmed" ta="center">
        {children}
      </Text>
    </Stack>
  );
}

const LEAD_KIND_COLOR: Record<string, MantineColor> = { open: "gray", hold: "yellow", won: "green", lost: "red" };

export function LeadStatusBadge({ kind, label }: { kind: string; label: string }) {
  return <Badge color={LEAD_KIND_COLOR[kind] ?? "gray"}>{label}</Badge>;
}
