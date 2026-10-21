import {
  ActionIcon,
  Badge,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Timeline as MTimeline,
  TimelineItem,
  Tooltip,
} from "@mantine/core";
import { ArrowRightLeft, Check, CircleDot, ListTodo, MessageSquare, Pencil, ReceiptIndianRupee, Sparkles, UserX } from "lucide-react";
import { completeTaskAction, logActivityAction } from "@/app/actions";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { Empty } from "@/components/ui";
import { taskBucket } from "@/domain/work";
import { ACTIVITY_LABEL, dateTime, FIELD_LABEL, inr, LIFECYCLE_LABEL, shortDate } from "@/lib/format";
import type { getTimeline } from "@/server/queries";
import { DateField } from "@/components/date-field";

type Item = Awaited<ReturnType<typeof getTimeline>>[number];
type EventItem = Extract<Item, { kind: "event" }>;

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") || "—" : String(v));

function describe(item: EventItem) {
  const { e } = item;
  const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.action) {
    case "stage_changed":
      return `${e.entityType === "onboarding" ? "Onboarding" : "Stage"}: ${d.from} → ${d.to}`;
    case "lead_status_changed":
      return `Lead status: ${d.from ?? "—"} → ${d.to}`;
    case "lifecycle_changed":
      return `Lifecycle: ${LIFECYCLE_LABEL[d.from as keyof typeof LIFECYCLE_LABEL]} → ${LIFECYCLE_LABEL[d.to as keyof typeof LIFECYCLE_LABEL]}`;
    case "created":
      if (e.entityType === "onboarding") return `Onboarding opened from “${d.fromDeal}”`;
      if (d.fromLead) return `Deal opened at ${d.stage} from lead ${d.fromLead}`;
      return e.entityType === "contact" ? `Lead created: ${d.name}` : `Created ${e.entityType}`;
    case "line_item_added":
      return `Pricing updated · MRR now ${inr(d.mrr)}`;
    case "line_item_removed":
      return `Pricing line removed · MRR now ${inr(d.mrr)}`;
    case "churned":
      return `Churned: ${d.reason}`;
    case "updated":
      return Object.entries(d as Record<string, { from: unknown; to: unknown }>)
        .map(([k, c]) => `${FIELD_LABEL[k] ?? k}: ${fmt(c.from)} → ${fmt(c.to)}`)
        .join(" · ");
    default:
      return e.action;
  }
}

function iconFor(item: Item) {
  if (item.kind === "activity") return item.a.completedAt ? <MessageSquare size={12} /> : <ListTodo size={12} />;
  switch (item.e.action) {
    case "stage_changed":
    case "lead_status_changed":
      return <ArrowRightLeft size={12} />;
    case "lifecycle_changed":
    case "created":
      return <Sparkles size={12} />;
    case "line_item_added":
    case "line_item_removed":
      return <ReceiptIndianRupee size={12} />;
    case "churned":
      return <UserX size={12} />;
    case "updated":
      return <Pencil size={12} />;
    default:
      return <CircleDot size={12} />;
  }
}

/** Due badge for an open task: red when overdue. */
export function DueBadge({ dueAt, now = new Date() }: { dueAt: Date | null; now?: Date }) {
  const bucket = taskBucket(dueAt, now);
  const color = bucket === "overdue" ? "red" : bucket === "today" ? "yellow" : "gray";
  const label = bucket === "today" ? "Due today" : dueAt ? `Due ${shortDate(dueAt)}` : "No due date";
  return <Badge color={color}>{label}</Badge>;
}

/** ✓ button that completes an open task. */
export function CompleteTaskButton({ activityId, subject }: { activityId: string; subject: string }) {
  return (
    <InlineAction action={completeTaskAction} hidden={{ activityId }}>
      <Tooltip label="Mark done">
        <ActionIcon type="submit" variant="light" color="green" size="sm" aria-label={`Mark "${subject}" done`}>
          <Check size={14} />
        </ActionIcon>
      </Tooltip>
    </InlineAction>
  );
}

export function Timeline({
  items,
  orgId,
  dealId,
  contactId,
  assignees,
}: {
  items: Item[];
  orgId: string;
  dealId?: string;
  contactId?: string;
  assignees?: { value: string; label: string }[];
}) {
  return (
    <Stack gap="md">
      <ActionForm action={logActivityAction}>
        <input type="hidden" name="orgId" value={orgId} />
        {dealId && <input type="hidden" name="dealId" value={dealId} />}
        {contactId && <input type="hidden" name="contactId" value={contactId} />}
        <Stack gap="xs">
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Select
              name="type"
              defaultValue="note"
              data={Object.entries(ACTIVITY_LABEL).map(([value, label]) => ({ value, label }))}
              w={130}
              aria-label="Activity type"
            />
            <TextInput name="subject" placeholder="What happened?" required style={{ flex: 1 }} aria-label="Subject" />
          </Group>
          <Textarea name="body" placeholder="Details (optional)" aria-label="Details" />
          <SimpleGrid cols={assignees ? 2 : 1} spacing="xs">
            <DateField name="dueDate" label="Follow-up due" description="Set a date to make it a task" size="xs" />
            {assignees && <Select name="assigneeId" label="Assign to" description="Defaults to you" clearable data={assignees} size="xs" />}
          </SimpleGrid>
          <div>
            <SubmitButton variant="default" size="xs">
              Save
            </SubmitButton>
          </div>
        </Stack>
      </ActionForm>

      {items.length === 0 ? (
        <Empty compact>No history yet</Empty>
      ) : (
        <MTimeline bulletSize={22} lineWidth={1}>
          {items.map((item) => (
            <TimelineItem key={item.kind === "event" ? `e${item.e.id}` : `a${item.a.id}`} bullet={iconFor(item)}>
              {item.kind === "event" ? (
                <Text size="sm">{describe(item)}</Text>
              ) : (
                <>
                  <Group gap="xs" justify="space-between" wrap="nowrap" align="flex-start">
                    <Text size="sm">
                      <Text span fw={700}>
                        {ACTIVITY_LABEL[item.a.type]}:
                      </Text>{" "}
                      {item.a.subject}
                    </Text>
                    {!item.a.completedAt && (
                      <Group gap={6} wrap="nowrap">
                        <DueBadge dueAt={item.a.dueAt} />
                        <CompleteTaskButton activityId={item.a.id} subject={item.a.subject} />
                      </Group>
                    )}
                  </Group>
                  {item.a.body && (
                    <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                      {item.a.body}
                    </Text>
                  )}
                </>
              )}
              <Text size="xs" c="dimmed" mt={2}>
                {item.actor ?? "System"} · {dateTime(item.at)}
              </Text>
            </TimelineItem>
          ))}
        </MTimeline>
      )}
    </Stack>
  );
}
