"use client";

import { Alert, Button, Group, List, Tooltip, type ButtonProps } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Lock } from "lucide-react";
import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, ...props }: ButtonProps & { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {children}
    </Button>
  );
}

/** Errors stay inline next to the form; successes become a toast. */
export function ActionResult({ state }: { state: ActionState }) {
  useEffect(() => {
    if (state?.ok && state.message) notifications.show({ message: state.message, color: "lime" });
  }, [state]);
  if (!state || state.ok) return null;
  return (
    <Alert color="red" variant="light" title={state.missing?.length ? "Fill these first" : undefined}>
      {state.missing?.length ? (
        <List size="sm" spacing={2}>
          {state.missing.map((m) => (
            <List.Item key={m.key}>{m.label}</List.Item>
          ))}
        </List>
      ) : (
        state.message ?? "Something went wrong"
      )}
    </Alert>
  );
}

/** A form bound to a server action, with inline errors and toast on success. */
export function ActionForm({
  action,
  children,
  resultPosition = "bottom",
  style,
}: {
  action: Action;
  children: ReactNode;
  resultPosition?: "top" | "bottom";
  style?: React.CSSProperties;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} style={style}>
      {resultPosition === "top" && <ActionResult state={state} />}
      {children}
      {resultPosition === "bottom" && <ActionResult state={state} />}
    </form>
  );
}

type StageOption = { key: string; name: string; kind: string; current: boolean; missing: { key: string; label: string }[] };

function StageButton({ stage }: { stage: StageOption }) {
  const { pending, data } = useFormStatus();
  const blocked = !stage.current && stage.missing.length > 0;
  const loading = pending && data?.get("stageKey") === stage.key;
  const color = stage.kind === "lost" ? "red" : stage.kind === "won" ? "green" : stage.kind === "hold" ? "yellow" : undefined;
  const button = (
    <Button
      type={stage.current ? "button" : "submit"}
      name="stageKey"
      value={stage.key}
      size="xs"
      fw={stage.current ? 700 : 600}
      variant={stage.current ? "filled" : blocked ? "default" : "light"}
      color={stage.current ? undefined : (color ?? "gray")}
      leftSection={blocked ? <Lock size={12} /> : undefined}
      loading={loading}
      aria-current={stage.current ? "step" : undefined}
      c={blocked ? "dimmed" : undefined}
    >
      {stage.name}
    </Button>
  );
  if (!blocked) return button;
  return (
    <Tooltip label={`Needs: ${stage.missing.map((m) => m.label).join(", ")}`} multiline w={260} withArrow>
      {button}
    </Tooltip>
  );
}

/**
 * Stage stepper. Stages whose gate isn't met show a lock and what's missing on hover;
 * the server re-checks on submit, so this is guidance, not enforcement.
 */
export function StageMover({ action, hidden, stages }: { action: Action; hidden: Record<string, string>; stages: StageOption[] }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Group gap={6}>
        {stages.map((s) => (
          <StageButton key={s.key} stage={s} />
        ))}
      </Group>
      <div style={{ marginTop: state && !state.ok ? 12 : 0 }}>
        <ActionResult state={state} />
      </div>
    </form>
  );
}

/** A one-button form (e.g. remove a row). Results surface as a toast, since there's no room inline: errors always, successes when they say something. */
export function InlineAction({
  action,
  hidden,
  children,
}: {
  action: Action;
  hidden: Record<string, string>;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (state && !state.ok) notifications.show({ color: "red", message: state.message ?? "Something went wrong" });
    else if (state?.ok && state.message) notifications.show({ color: "lime", message: state.message });
  }, [state]);
  return (
    <form action={formAction} style={{ display: "inline" }}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
    </form>
  );
}
