"use client";
/**
 * Row selection and a bulk-change bar for server-rendered lists. The page renders <BulkCheckbox>
 * in each row and <BulkBar> with the fields to change; the bar submits the selected ids with them
 * to a server action, which updates each record on its own (audit log, webhooks, gates).
 */
import { Button, Card, Checkbox, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import type { ActionState } from "@/app/actions";

type Ctx = { selected: Set<string>; toggle: (id: string) => void; setAll: (on: boolean) => void; allIds: string[] };
const BulkContext = createContext<Ctx | null>(null);

export function BulkProvider({ allIds, children }: { allIds: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (on: boolean) => setSelected(on ? new Set(allIds) : new Set());
  return <BulkContext.Provider value={{ selected, toggle, setAll, allIds }}>{children}</BulkContext.Provider>;
}

export function BulkCheckbox({ id, label }: { id: string; label: string }) {
  const ctx = useContext(BulkContext)!;
  return <Checkbox size="xs" checked={ctx.selected.has(id)} onChange={() => ctx.toggle(id)} aria-label={`Select ${label}`} />;
}

export function BulkHeaderCheckbox() {
  const ctx = useContext(BulkContext)!;
  const n = ctx.selected.size;
  return (
    <Checkbox
      size="xs"
      checked={n > 0 && n === ctx.allIds.length}
      indeterminate={n > 0 && n < ctx.allIds.length}
      onChange={(e) => ctx.setAll(e.currentTarget.checked)}
      aria-label="Select all rows shown"
    />
  );
}

/**
 * Shown while rows are selected. `children` are the fields (Selects named after what they change;
 * leave a field empty to keep each record's value). Successful changes clear the selection.
 */
export function BulkBar({ action, noun, children }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; noun: string; children: ReactNode }) {
  const ctx = useContext(BulkContext)!;
  const [pending, start] = useTransition();
  if (ctx.selected.size === 0) return null;
  const submit = (fd: FormData) => {
    fd.set("ids", [...ctx.selected].join(","));
    start(async () => {
      const res = await action(null, fd);
      notifications.show({ color: res?.ok ? "lime" : "red", message: res?.message ?? "Something went wrong", autoClose: res?.ok ? 4000 : 10000 });
      if (res?.ok) ctx.setAll(false);
    });
  };
  return (
    <Card withBorder shadow="sm" p="sm" style={{ position: "sticky", bottom: 16, zIndex: 5 }}>
      <form action={submit}>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <Text size="sm" fw={700} style={{ alignSelf: "center" }}>
            {ctx.selected.size} {noun} selected
          </Text>
          {children}
          <Group gap={6} ml="auto">
            <Button variant="subtle" size="sm" onClick={() => ctx.setAll(false)} disabled={pending}>
              Clear
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              Apply to {ctx.selected.size}
            </Button>
          </Group>
        </Group>
      </form>
    </Card>
  );
}
