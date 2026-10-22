"use client";
/**
 * Campaign editor: settings, content blocks and a live preview rendered with the same renderer that
 * builds the real email (src/domain/campaigns.ts), personalised for the list's first member.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Grid,
  GridCol,
  Group,
  Menu,
  MenuDropdown,
  MenuItem,
  MenuTarget,
  Modal,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { ArrowDown, ArrowUp, Plus, Send, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { BLOCK_LABEL, renderEmail, SUBSCRIPTION_TYPES, TOKENS, type Block, type Vars } from "@/domain/campaigns";
import { saveCampaignAction, scheduleAction, sendNowAction, sendTestAction, type CampaignContent } from "../actions";

type ListOption = { value: string; label: string; members: number };
type Props = {
  id: string;
  initial: CampaignContent;
  status: string;
  scheduledAt: string | null;
  lists: ListOption[];
  sample: Partial<Vars>;
  problems: string[];
  canSend: boolean;
  logoUrl: string;
};

const NEW_BLOCK: Record<Block["type"], Block> = {
  heading: { type: "heading", text: "A clear headline" },
  text: { type: "text", text: "" },
  button: { type: "button", label: "Learn more", url: "https://limechat.ai" },
  image: { type: "image", src: "https://", alt: "" },
  divider: { type: "divider" },
};

function BlockFields({ b, set }: { b: Block; set: (b: Block) => void }) {
  if (b.type === "heading") return <TextInput value={b.text} onChange={(e) => set({ ...b, text: e.currentTarget.value })} aria-label="Heading" />;
  if (b.type === "text")
    return (
      <Textarea
        value={b.text}
        onChange={(e) => set({ ...b, text: e.currentTarget.value })}
        minRows={3}
        aria-label="Text"
        description="Blank line = new paragraph · **bold** · [link text](https://…)"
      />
    );
  if (b.type === "button")
    return (
      <SimpleGrid cols={2} spacing="xs">
        <TextInput label="Label" value={b.label} onChange={(e) => set({ ...b, label: e.currentTarget.value })} />
        <TextInput label="Link" value={b.url} onChange={(e) => set({ ...b, url: e.currentTarget.value })} />
      </SimpleGrid>
    );
  if (b.type === "image")
    return (
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
        <TextInput label="Image URL" value={b.src} onChange={(e) => set({ ...b, src: e.currentTarget.value })} />
        <TextInput label="Alt text" value={b.alt} onChange={(e) => set({ ...b, alt: e.currentTarget.value })} />
        <TextInput label="Link (optional)" value={b.href ?? ""} onChange={(e) => set({ ...b, href: e.currentTarget.value || undefined })} />
      </SimpleGrid>
    );
  return (
    <Text size="xs" c="dimmed">
      A thin line between sections.
    </Text>
  );
}

export function CampaignEditor({ id, initial, status, scheduledAt, lists, sample, problems, canSend, logoUrl }: Props) {
  const [c, setC] = useState<CampaignContent>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const [confirm, setConfirm] = useState(false);
  const [when, setWhen] = useState<string | null>(scheduledAt);
  const update = (patch: Partial<CampaignContent>) => {
    setC((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };
  const setBlock = (i: number, b: Block) => update({ blocks: c.blocks.map((x, j) => (j === i ? b : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...c.blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    update({ blocks: next });
  };
  const list = lists.find((l) => l.value === c.listId);

  const preview = useMemo(
    () =>
      renderEmail(
        { subject: c.subject, preheader: c.preheader, blocks: c.blocks, logoUrl },
        { ...sample, sender_name: c.fromName },
        {
          companyLine: "LimeChat",
          address: "LimeChat's postal address",
          unsubscribeUrl: "#",
          preferencesUrl: "#",
          reason: `You're getting this because you're subscribed to ${SUBSCRIPTION_TYPES.find((t) => t.key === c.subscriptionType)?.label.toLowerCase()} from LimeChat.`,
        },
      ),
    [c, sample, logoUrl],
  );

  const run = (fn: () => Promise<{ ok: boolean; message?: string } | null>, saveFirst = true) =>
    start(async () => {
      if (saveFirst && dirty) {
        const saved = await saveCampaignAction(id, c);
        if (!saved?.ok) {
          notifications.show({ color: "red", message: saved?.message ?? "Couldn't save" });
          return;
        }
        setDirty(false);
      }
      const res = await fn();
      if (res?.message) notifications.show({ color: res.ok ? "lime" : "red", message: res.message, autoClose: res.ok ? 4000 : 10000 });
    });

  const locked = status !== "draft";
  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <Badge color={status === "scheduled" ? "yellow" : "gray"}>{status === "scheduled" ? "Scheduled" : "Draft"}</Badge>
          {dirty && (
            <Text size="xs" c="dimmed">
              Unsaved changes
            </Text>
          )}
        </Group>
        <Group gap="xs">
          <Button
            variant="default"
            size="xs"
            loading={pending}
            onClick={() => run(async () => saveCampaignAction(id, c).then((r) => (setDirty(!r?.ok), r)), false)}
          >
            Save
          </Button>
          <Button variant="default" size="xs" disabled={pending} onClick={() => run(() => sendTestAction(id))}>
            Send me a test
          </Button>
          {status === "scheduled" ? (
            <Button variant="default" size="xs" disabled={pending || !canSend} onClick={() => run(() => scheduleAction(id, null))}>
              Unschedule
            </Button>
          ) : (
            <Group gap={4} wrap="nowrap">
              <DateTimePicker
                size="xs"
                w={190}
                placeholder="Schedule for…"
                value={when}
                onChange={setWhen}
                valueFormat="DD MMM YYYY, hh:mm A"
                clearable
                minDate={new Date()}
              />
              <Button variant="default" size="xs" disabled={pending || !when || !canSend} onClick={() => run(() => scheduleAction(id, when))}>
                Schedule
              </Button>
            </Group>
          )}
          <Button size="xs" leftSection={<Send size={14} />} disabled={pending || !canSend || !list || problems.length > 0} onClick={() => setConfirm(true)}>
            Send now
          </Button>
        </Group>
      </Group>

      {problems.length > 0 && (
        <Alert color="yellow" variant="light" title="Before this can be sent">
          <Stack gap={2}>
            {problems.map((p) => (
              <Text key={p} size="sm">
                • {p}
              </Text>
            ))}
            <Text size="xs" c="dimmed">
              Checked against the last saved version.
            </Text>
          </Stack>
        </Alert>
      )}

      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 6 }}>
          <Stack gap="lg">
            <Card withBorder>
              <Title order={5} mb="sm">
                Settings
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Campaign name"
                  description="Only you see this"
                  value={c.name}
                  onChange={(e) => update({ name: e.currentTarget.value })}
                  disabled={locked}
                />
                <Select
                  label="List"
                  description={list ? `${list.members.toLocaleString("en-IN")} people with an email` : "Who it goes to"}
                  data={lists.map((l) => ({ value: l.value, label: l.label }))}
                  value={c.listId}
                  onChange={(v) => update({ listId: v })}
                  searchable
                  disabled={locked}
                />
                <Select
                  label="Subscription type"
                  description="People who opted out of this type are skipped"
                  data={SUBSCRIPTION_TYPES.map((t) => ({ value: t.key, label: t.label }))}
                  value={c.subscriptionType}
                  onChange={(v) => v && update({ subscriptionType: v })}
                  allowDeselect={false}
                  disabled={locked}
                />
                <TextInput label="From name" value={c.fromName} onChange={(e) => update({ fromName: e.currentTarget.value })} disabled={locked} />
                <TextInput label="From email" value={c.fromEmail} onChange={(e) => update({ fromEmail: e.currentTarget.value })} disabled={locked} />
                <TextInput label="Reply-to" value={c.replyTo ?? ""} onChange={(e) => update({ replyTo: e.currentTarget.value || null })} disabled={locked} />
              </SimpleGrid>
              <Stack gap="sm" mt="sm">
                <TextInput label="Subject" value={c.subject} onChange={(e) => update({ subject: e.currentTarget.value })} disabled={locked} />
                <TextInput
                  label="Preview text"
                  description="The grey line after the subject in most inboxes"
                  value={c.preheader ?? ""}
                  onChange={(e) => update({ preheader: e.currentTarget.value || null })}
                  disabled={locked}
                />
                <Text size="xs" c="dimmed">
                  Personalise with {TOKENS.map((t) => `{{${t.key}}}`).join(", ")}. Add a fallback for empty values: <Code>{"{{first_name|there}}"}</Code>.
                </Text>
              </Stack>
            </Card>

            <Card withBorder>
              <Group justify="space-between" mb="sm">
                <Title order={5}>Content</Title>
                <Menu position="bottom-end">
                  <MenuTarget>
                    <Button size="xs" variant="default" leftSection={<Plus size={14} />} disabled={locked}>
                      Add block
                    </Button>
                  </MenuTarget>
                  <MenuDropdown>
                    {(Object.keys(NEW_BLOCK) as Block["type"][]).map((t) => (
                      <MenuItem key={t} onClick={() => update({ blocks: [...c.blocks, NEW_BLOCK[t]] })}>
                        {BLOCK_LABEL[t]}
                      </MenuItem>
                    ))}
                  </MenuDropdown>
                </Menu>
              </Group>
              <Stack gap="sm">
                {c.blocks.map((b, i) => (
                  <Card key={i} withBorder shadow="none" padding="sm">
                    <Group justify="space-between" mb={6}>
                      <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                        {BLOCK_LABEL[b.type]}
                      </Text>
                      <Group gap={2}>
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => move(i, -1)} disabled={locked || i === 0} aria-label="Move up">
                          <ArrowUp size={14} />
                        </ActionIcon>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          onClick={() => move(i, 1)}
                          disabled={locked || i === c.blocks.length - 1}
                          aria-label="Move down"
                        >
                          <ArrowDown size={14} />
                        </ActionIcon>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => update({ blocks: c.blocks.filter((_, j) => j !== i) })}
                          disabled={locked}
                          aria-label="Remove block"
                        >
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                    <BlockFields b={b} set={(nb) => setBlock(i, nb)} />
                  </Card>
                ))}
                {c.blocks.length === 0 && (
                  <Text size="sm" c="dimmed">
                    Add a heading, some text and a button.
                  </Text>
                )}
              </Stack>
            </Card>
          </Stack>
        </GridCol>

        <GridCol span={{ base: 12, lg: 6 }}>
          <Card withBorder style={{ position: "sticky", top: 16 }}>
            <Group justify="space-between" mb="sm">
              <Stack gap={0}>
                <Title order={5}>Preview</Title>
                <Text size="xs" c="dimmed">
                  As {sample.name || "a list member"} would see it
                </Text>
              </Stack>
              <SegmentedControl
                size="xs"
                value={width}
                onChange={(v) => setWidth(v as "desktop" | "phone")}
                data={[
                  { value: "desktop", label: "Desktop" },
                  { value: "phone", label: "Phone" },
                ]}
              />
            </Group>
            <Text size="sm" fw={700}>
              {preview.subject || "(no subject)"}
            </Text>
            <Text size="xs" c="dimmed" mb="xs">
              {c.fromName} &lt;{c.fromEmail}&gt;
            </Text>
            <iframe
              title="Email preview"
              srcDoc={preview.html}
              sandbox="allow-same-origin"
              style={{
                width: width === "phone" ? 375 : "100%",
                maxWidth: "100%",
                height: 640,
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: 4,
                background: "white",
              }}
            />
          </Card>
        </GridCol>
      </Grid>

      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Send this campaign now?">
        <Stack gap="sm">
          <Text size="sm">
            It goes to <b>{list?.members.toLocaleString("en-IN")}</b> people on <b>{list?.label}</b>, minus anyone unsubscribed from{" "}
            {SUBSCRIPTION_TYPES.find((t) => t.key === c.subscriptionType)?.label.toLowerCase()} or whose address bounced. This can&apos;t be stopped once it
            starts.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>
              Not yet
            </Button>
            <Button
              leftSection={<Send size={14} />}
              loading={pending}
              onClick={() =>
                run(async () => {
                  const r = await sendNowAction(id);
                  setConfirm(false);
                  return r;
                })
              }
            >
              Send to {list?.members.toLocaleString("en-IN")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
