import {
  ActionIcon,
  Badge,
  Checkbox,
  Divider,
  Grid,
  GridCol,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addLineItemAction, deleteLineItemAction, moveDealAction, saveDealAction } from "@/app/actions";
import { ActionForm, InlineAction, StageMover, SubmitButton } from "@/components/forms";
import { AnchorLink } from "@/components/links";
import { Timeline } from "@/components/timeline";
import { Empty, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";
import { isOneTime, monthlyValue, periodAmount } from "@/domain/mrr";
import { CYCLE_LABEL, DEAL_TYPE_LABEL, inr, inrPrecise, LINE_ITEM_LABEL, options, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getDeal, getTimeline, listUsers } from "@/server/queries";

export const metadata: Metadata = { title: "Deal" };

const PLANS = ["Enterprise/ Custom", "LimeBot", "LimeBusiness", "LimeMarketer"];
const PRODUCTS = ["Chat BOT", "Voice BOT", "Helpdesk", "Marketing Platform"];
const LOST_REASONS = [
  "No Differentiation",
  "Lost To Competitor - Pricing Gap",
  "Lost To Competitor - Product Gap",
  "Budget",
  "Timeline issues",
  "AE/SDR Failure",
  "Signed but never paid",
];
const PRIORITY = { high: "High", medium: "Medium", low: "Low" };
const tabular = { fontVariantNumeric: "tabular-nums" } as const;

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();
  const { deal, org, lineItems, current, gates, contacts } = data;
  const [people, timeline] = await Promise.all([listUsers(), getTimeline({ dealId: deal.id, orgId: org.id })]);
  const userOptions = people.map((u) => ({ value: u.id, label: u.name }));

  return (
    <>
      <PageHeader
        title={deal.title}
        subtitle={
          <Group gap="xs">
            <AnchorLink href={`/companies/${org.id}`} fw={700} size="sm">
              {org.name}
            </AnchorLink>
            <StatusBadge status={deal.status} label={current.name} />
            <Badge color="gray">{DEAL_TYPE_LABEL[deal.type]}</Badge>
            {deal.endedAt && <Badge color="yellow">Contract ended {shortDate(deal.endedAt)}</Badge>}
          </Group>
        }
        actions={
          <Group gap="xl">
            <Stat label="MRR" value={inr(deal.mrr)} align="right" />
            <Stat label="One-time" value={inr(deal.oneTimeFee)} align="right" />
          </Group>
        }
      />

      <Stack gap="lg">
        <Section title="Stage">
          <StageMover
            action={moveDealAction}
            hidden={{ dealId: deal.id }}
            stages={gates.map((g) => ({
              key: g.stage.key,
              name: g.stage.name,
              kind: g.stage.kind,
              current: g.stage.id === deal.stageId,
              missing: g.missing,
            }))}
          />
        </Section>

        <Grid gap="lg">
          <GridCol span={{ base: 12, lg: 8 }}>
            <Stack gap="lg">
              <Section title="Pricing" actions={<Text size="xs" c="dimmed">MRR is computed from these lines</Text>}>
                {lineItems.length === 0 ? (
                  <Empty>No pricing yet. Add the platform fee and rate card below.</Empty>
                ) : (
                  <TableScrollContainer minWidth={560}>
                    <Table>
                      <TableThead>
                        <TableTr>
                          <TableTh>Item</TableTh>
                          <TableTh ta="right">Unit price</TableTh>
                          <TableTh ta="right">Qty (free)</TableTh>
                          <TableTh>Cycle</TableTh>
                          <TableTh ta="right">Monthly</TableTh>
                          <TableTh w={40} />
                        </TableTr>
                      </TableThead>
                      <TableTbody>
                        {lineItems.map((li) => (
                          <TableTr key={li.id}>
                            <TableTd>
                              <Text size="sm" fw={600}>
                                {LINE_ITEM_LABEL[li.kind]}
                              </Text>
                              {li.description && (
                                <Text size="xs" c="dimmed">
                                  {li.description}
                                </Text>
                              )}
                            </TableTd>
                            <TableTd ta="right" style={tabular}>
                              {inrPrecise(li.unitPrice)}
                            </TableTd>
                            <TableTd ta="right" style={tabular}>
                              {li.quantity}
                              {li.includedFree > 0 && (
                                <Text span c="dimmed" size="sm">
                                  {" "}
                                  ({li.includedFree})
                                </Text>
                              )}
                            </TableTd>
                            <TableTd>{CYCLE_LABEL[li.billingCycle]}</TableTd>
                            <TableTd ta="right" style={tabular} fw={600}>
                              {isOneTime(li) ? (
                                <Text span size="sm" c="dimmed">
                                  {inr(periodAmount(li))} once
                                </Text>
                              ) : (
                                inr(monthlyValue(li))
                              )}
                            </TableTd>
                            <TableTd>
                              <InlineAction action={deleteLineItemAction} hidden={{ dealId: deal.id, itemId: li.id }}>
                                <Tooltip label="Remove line">
                                  <ActionIcon type="submit" aria-label={`Remove ${LINE_ITEM_LABEL[li.kind]}`}>
                                    <Trash2 size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              </InlineAction>
                            </TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                )}

                <Divider my="md" />
                <ActionForm action={addLineItemAction}>
                  <input type="hidden" name="dealId" value={deal.id} />
                  <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="sm">
                    <Select name="kind" label="Item" defaultValue="platform_fee" data={options(LINE_ITEM_LABEL)} />
                    <NumberInput name="unitPrice" label="Unit price (₹)" min={0} decimalScale={4} required hideControls />
                    <NumberInput name="quantity" label="Quantity" min={0} defaultValue={1} decimalScale={2} hideControls />
                    <NumberInput name="includedFree" label="Free incl." min={0} defaultValue={0} decimalScale={2} hideControls />
                    <Select name="billingCycle" label="Cycle" defaultValue="monthly" data={options(CYCLE_LABEL)} />
                    <TextInput name="description" label="Note" placeholder="Optional" />
                  </SimpleGrid>
                  <Group justify="space-between" mt="sm" wrap="wrap">
                    <Text size="xs" c="dimmed">
                      Usage-only rates (per minute, per session) go in with quantity 0: they&apos;re recorded but don&apos;t add to committed MRR.
                    </Text>
                    <SubmitButton variant="default">Add line</SubmitButton>
                  </Group>
                </ActionForm>
              </Section>

              <Section title="Deal details">
                <ActionForm action={saveDealAction} resultPosition="top">
                  <input type="hidden" name="dealId" value={deal.id} />
                  <Stack gap="md">
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      <TextInput name="title" label="Title" defaultValue={deal.title} required />
                      <Select name="type" label="Type" defaultValue={deal.type} data={options(DEAL_TYPE_LABEL)} />
                      <Select name="ownerId" label="Account Executive" defaultValue={deal.ownerId} clearable data={userOptions} />
                      <Select name="sdrId" label="SDR" defaultValue={deal.sdrId} clearable data={userOptions} />
                      <Select
                        name="primaryContactId"
                        label="Primary contact"
                        defaultValue={deal.primaryContactId}
                        clearable
                        data={contacts.map((c) => ({ value: c.id, label: c.name }))}
                      />
                      <Select name="plan" label="Plan" defaultValue={deal.plan} clearable data={PLANS} />
                      <TagsInput
                        name="products"
                        label="Products"
                        defaultValue={deal.products}
                        data={PRODUCTS}
                        splitChars={[","]}
                        description="Pick or type, Enter to add"
                      />
                      <Select name="priority" label="Priority" defaultValue={deal.priority} clearable data={options(PRIORITY)} />
                      <TextInput name="expectedCloseDate" label="Expected close" type="date" defaultValue={deal.expectedCloseDate ?? ""} />
                      <TextInput name="source" label="Source" defaultValue={deal.source ?? ""} />
                      <TextInput name="partnerName" label="Partner" defaultValue={deal.partnerName ?? ""} />
                    </SimpleGrid>

                    <Divider label="Contract" labelPosition="left" />
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      <Select name="billingCycle" label="Billing cycle" defaultValue={deal.billingCycle} clearable data={options(CYCLE_LABEL)} />
                      <Select name="currency" label="Currency" defaultValue={deal.currency} data={["INR", "USD"]} />
                      <TextInput name="contractStart" label="Contract start" type="date" defaultValue={deal.contractStart ?? ""} />
                      <TextInput name="contractRenewal" label="Contract renewal" type="date" defaultValue={deal.contractRenewal ?? ""} />
                      <TextInput
                        name="contractLink"
                        label="Contract link"
                        type="url"
                        defaultValue={deal.contractLink ?? ""}
                        placeholder="https://drive.google.com/…"
                      />
                      <Checkbox
                        name="requiresOnboarding"
                        label="Needs onboarding when won"
                        defaultChecked={deal.requiresOnboarding}
                        mt={{ sm: 30 }}
                      />
                    </SimpleGrid>

                    <Divider label="If lost" labelPosition="left" />
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      <Select name="lostReason" label="Lost reason" defaultValue={deal.lostReason} clearable data={LOST_REASONS} />
                      <Textarea name="lostDetail" label="Detail" defaultValue={deal.lostDetail ?? ""} />
                    </SimpleGrid>
                    <Group>
                      <SubmitButton>Save deal</SubmitButton>
                    </Group>
                  </Stack>
                </ActionForm>
              </Section>
            </Stack>
          </GridCol>

          <GridCol span={{ base: 12, lg: 4 }}>
            <Stack gap="lg">
              <Section title="Summary">
                <SimpleGrid cols={2} spacing="md">
                  <Stat label="Owner" value={people.find((p) => p.id === deal.ownerId)?.name ?? "—"} />
                  <Stat label="Expected close" value={shortDate(deal.expectedCloseDate)} />
                  <Stat label="Contract" value={`${shortDate(deal.contractStart)} → ${shortDate(deal.contractRenewal)}`} />
                  <Stat label="Closed" value={deal.closedAt ? shortDate(deal.closedAt) : "—"} />
                </SimpleGrid>
              </Section>
              <Section title="Activity & history">
                <Timeline items={timeline} orgId={org.id} dealId={deal.id} assignees={userOptions} />
              </Section>
            </Stack>
          </GridCol>
        </Grid>
      </Stack>
    </>
  );
}
