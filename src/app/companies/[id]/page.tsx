import {
  Anchor,
  Avatar,
  Badge,
  Divider,
  Grid,
  GridCol,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  churnAction,
  createDealAction,
  moveOnboardingAction,
  saveOnboardingAction,
  saveOrganizationAction,
} from "@/app/actions";
import classes from "@/components/board.module.css";
import { ActionForm, StageMover, SubmitButton } from "@/components/forms";
import { AnchorLink, ButtonLink } from "@/components/links";
import { Timeline } from "@/components/timeline";
import { Empty, LifecycleBadge, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";
import { CHURN_LABEL, DEAL_TYPE_LABEL, initials, inr, LIFECYCLE_LABEL, options, SEGMENT_LABEL, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getOrganization, getTimeline, listUsers, recordTitle } from "@/server/queries";
import { DateField } from "@/components/date-field";
import { ReconnectForm } from "@/components/reconnect-form";
import { websiteHref } from "@/domain/fields";
import { getFieldOptions, selectData } from "@/server/fields";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await recordTitle("organization", (await params).id)) ?? "Not found" };
}

const HEALTH = { green: "Green", yellow: "Yellow", red: "Red" };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const data = await getOrganization(id);
  if (!data) notFound();
  const { org, deals, contacts, openOnboarding, onboardingGates } = data;
  const [people, timeline, fieldOpts] = await Promise.all([listUsers(), getTimeline({ orgId: org.id }), getFieldOptions()]);
  const userOptions = people.map((u) => ({ value: u.id, label: u.name }));
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? "—";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={
          <Group gap="xs">
            <LifecycleBadge lifecycle={org.lifecycle} label={LIFECYCLE_LABEL[org.lifecycle]} />
            {org.segment && <Badge color="gray">{SEGMENT_LABEL[org.segment]}</Badge>}
            {org.website && (
              <Anchor href={websiteHref(org.website)} target="_blank" rel="noreferrer" size="sm" c="dimmed">
                {org.website.replace(/^https?:\/\//, "")}
              </Anchor>
            )}
          </Group>
        }
        actions={
          <Group gap="xl">
            <Stat label="Contracted MRR" value={inr(org.contractedMrr)} align="right" />
            <Stat label="AE" value={name(org.aeId)} align="right" />
            <Stat label="Onboarding" value={name(org.omId)} align="right" />
            <Stat label="CSM" value={name(org.csmId)} align="right" />
          </Group>
        }
      />

      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 8 }}>
          <Stack gap="lg">
            {openOnboarding && (
              <Section
                title="Onboarding"
                actions={
                  <Text size="xs" c="dimmed">
                    Opened {shortDate(openOnboarding.createdAt)}
                  </Text>
                }
              >
                <StageMover
                  action={moveOnboardingAction}
                  hidden={{ onboardingId: openOnboarding.id }}
                  stages={onboardingGates.map((g) => ({
                    key: g.stage.key,
                    name: g.stage.name,
                    kind: g.stage.kind,
                    current: g.stage.id === openOnboarding.stageId,
                    missing: g.missing,
                  }))}
                />
                <Divider my="md" />
                <ActionForm action={saveOnboardingAction} resultPosition="top">
                  <input type="hidden" name="onboardingId" value={openOnboarding.id} />
                  <Stack gap="sm">
                    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                      <Select name="omId" label="Onboarding manager" defaultValue={openOnboarding.omId} clearable data={userOptions} />
                      <DateField name="kickoffDate" label="Kick-off date" defaultValue={openOnboarding.kickoffDate ?? ""} />
                      <DateField name="goLiveDate" label="Go-live date" defaultValue={openOnboarding.goLiveDate ?? ""} />
                      <Select name="health" label="Health" defaultValue={openOnboarding.health} clearable data={options(HEALTH)} />
                      <NumberInput name="nps" label="NPS at handoff" min={0} max={10} defaultValue={openOnboarding.nps ?? undefined} hideControls />
                      <TextInput name="voiceAdoption" label="Voice adoption" defaultValue={openOnboarding.voiceAdoption ?? ""} />
                    </SimpleGrid>
                    <Textarea name="notes" label="Notes" defaultValue={openOnboarding.notes ?? ""} />
                    <Group>
                      <SubmitButton variant="default">Save onboarding</SubmitButton>
                    </Group>
                  </Stack>
                </ActionForm>
              </Section>
            )}

            <Section
              title={`Deals (${deals.length})`}
              actions={
                <Text size="xs" c="dimmed">
                  New, upsell, renewal: one company, every deal
                </Text>
              }
            >
              {deals.length === 0 ? (
                <Empty>No deals yet</Empty>
              ) : (
                <Stack gap={0}>
                  {deals.map(({ deal, stageName }) => (
                    <ButtonLink
                      key={deal.id}
                      href={`/deals/${deal.id}`}
                      className={classes.card}
                      style={{ border: 0, borderBottom: "1px solid var(--mantine-color-default-border)", borderRadius: 0 }}
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={700}>
                            {deal.title}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {DEAL_TYPE_LABEL[deal.type]} · {stageName}
                            {deal.endedAt && ` · ended ${shortDate(deal.endedAt)}`}
                          </Text>
                        </div>
                        <Group gap="sm" wrap="nowrap">
                          <Text size="sm" fw={600}>
                            {inr(deal.mrr)}
                            <Text span size="xs" c="dimmed">
                              /mo
                            </Text>
                          </Text>
                          <StatusBadge status={deal.status} />
                          <ChevronRight size={16} color="var(--mantine-color-dimmed)" />
                        </Group>
                      </Group>
                    </ButtonLink>
                  ))}
                </Stack>
              )}
              <ActionForm action={createDealAction}>
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="ownerId" value={org.aeId ?? ""} />
                <Group align="flex-end" mt="md" gap="sm" wrap="wrap">
                  <TextInput name="title" label="New deal" required placeholder={`${org.name} - Voice upsell`} style={{ flex: 1, minWidth: 220 }} />
                  <Select
                    name="type"
                    label="Type"
                    defaultValue={org.lifecycle === "prospect" ? "new_business" : "upsell"}
                    data={options(DEAL_TYPE_LABEL)}
                    w={160}
                  />
                  <SubmitButton variant="default">Add deal</SubmitButton>
                </Group>
              </ActionForm>
            </Section>

            <Section title="Company details">
              <ActionForm action={saveOrganizationAction} resultPosition="top">
                <input type="hidden" name="orgId" value={org.id} />
                <Stack gap="sm">
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <TextInput name="name" label="Name" defaultValue={org.name} required />
                    <TextInput name="website" label="Website" placeholder="acme.in" description="Saved as the domain" defaultValue={org.website ?? ""} />
                    <Select name="segment" label="Segment" defaultValue={org.segment} clearable data={options(SEGMENT_LABEL)} />
                    <Select name="industry" label="Industry" defaultValue={org.industry} clearable searchable data={selectData(fieldOpts, "industry", org.industry)} />
                    <Select
                      name="websiteTrafficRange"
                      label="Website traffic"
                      defaultValue={org.websiteTrafficRange}
                      clearable
                      data={selectData(fieldOpts, "traffic_band", org.websiteTrafficRange)}
                    />
                    <TextInput name="hqCity" label="HQ city" defaultValue={org.hqCity ?? ""} />
                    <TextInput
                      name="lcAccountIds"
                      label="LC Account IDs"
                      description="Comma-separated"
                      defaultValue={org.lcAccountIds.join(", ")}
                    />
                    <Select name="aeId" label="Account Executive" defaultValue={org.aeId} clearable data={userOptions} />
                    <Select name="omId" label="Onboarding manager" defaultValue={org.omId} clearable data={userOptions} />
                    <Select name="csmId" label="CSM" defaultValue={org.csmId} clearable data={userOptions} />
                    <TextInput name="chargebeeCustomerId" label="Chargebee customer ID" defaultValue={org.chargebeeCustomerId ?? ""} />
                    <TextInput name="clientChannel" label="Client Slack channel" defaultValue={org.clientChannel ?? ""} placeholder="#client-o-…" />
                    <Select name="health" label="Health" defaultValue={org.health} clearable data={options(HEALTH)} />
                  </SimpleGrid>
                  <Textarea name="healthNote" label="Health note" defaultValue={org.healthNote ?? ""} />
                  <Group>
                    <SubmitButton>Save company</SubmitButton>
                  </Group>
                </Stack>
              </ActionForm>
            </Section>
          </Stack>
        </GridCol>

        <GridCol span={{ base: 12, lg: 4 }}>
          <Stack gap="lg">
            <Section title={`Contacts (${contacts.length})`}>
              {contacts.length === 0 ? (
                <Empty compact>No contacts</Empty>
              ) : (
                <Stack gap="sm">
                  {contacts.map((c) => (
                    <Group key={c.id} gap="sm" wrap="nowrap" align="flex-start">
                      <Avatar radius="xl" size={32} color="lime">
                        {initials(c.name)}
                      </Avatar>
                      <div style={{ minWidth: 0 }}>
                        <Group gap={6}>
                          <AnchorLink href={`/leads/${c.id}`} size="sm" fw={700} c="var(--mantine-color-text)">
                            {c.name}
                          </AnchorLink>
                          {c.isDecisionMaker && <Badge color="lime">DM</Badge>}
                        </Group>
                        <Text size="xs" c="dimmed">
                          {[c.designation, c.email].filter(Boolean).join(" · ")}
                        </Text>
                      </div>
                    </Group>
                  ))}
                </Stack>
              )}
            </Section>

            {org.lifecycle === "churned" ? (
              <Section title="Churned">
                <Stack gap={4}>
                  <Text size="sm">
                    {shortDate(org.churnedAt)} · {org.churnCategory ? CHURN_LABEL[org.churnCategory] : "—"}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {org.churnReason}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Last billing {shortDate(org.churnLastBillingDate)}
                  </Text>
                </Stack>
              </Section>
            ) : (
              org.lifecycle !== "prospect" && (
                <Section title="Mark churned">
                  <ActionForm action={churnAction}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <Stack gap="sm">
                      <DateField name="churnedAt" label="Churn date" defaultValue={today} required />
                      <Select name="category" label="Category" defaultValue="payment" data={options(CHURN_LABEL)} />
                      <DateField name="lastBillingDate" label="Last billing date" />
                      <Textarea name="reason" label="Reason" />
                      <Text size="xs" c="dimmed">
                        Ends every live contract, closes onboarding and drops contracted MRR to ₹0.
                      </Text>
                      <SubmitButton color="red">Mark churned</SubmitButton>
                    </Stack>
                  </ActionForm>
                </Section>
              )
            )}

            {(org.reconnectOn || org.lifecycle === "prospect" || org.lifecycle === "churned") && (
              <Section title={org.reconnectOn ? `Reconnect ${shortDate(org.reconnectOn)}` : "Reconnect later"}>
                <ReconnectForm orgId={org.id} on={org.reconnectOn} reason={org.reconnectReason} aeName={org.aeId ? name(org.aeId) : null} />
              </Section>
            )}

            <Section title="History">
              <Timeline items={timeline} orgId={org.id} assignees={userOptions} />
            </Section>
          </Stack>
        </GridCol>
      </Grid>
    </>
  );
}
