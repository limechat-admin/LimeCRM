import {
  Badge,
  Checkbox,
  Divider,
  Grid,
  GridCol,
  Group,
  MultiSelect,
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
import { moveLeadAction, saveLeadAction } from "@/app/actions";
import { BantFields } from "@/components/bant-fields";
import classes from "@/components/board.module.css";
import { ActionForm, StageMover, SubmitButton } from "@/components/forms";
import { AnchorLink, ButtonLink } from "@/components/links";
import { Timeline } from "@/components/timeline";
import { Empty, LeadStatusBadge, LifecycleBadge, PageHeader, Section, Stat, StatusBadge } from "@/components/ui";
import { bantTotal, LEAD_STAGES, LEAD_STATUSES, leadStatusMissing, type LeadStatus } from "@/domain/leads";
import { inr, LIFECYCLE_LABEL, options, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { getLead, getTimeline, listUsers, recordTitle } from "@/server/queries";
import { DateField } from "@/components/date-field";
import { getFieldOptions, selectData } from "@/server/fields";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return { title: (await recordTitle("lead", (await params).id)) ?? "Not found" };
}


export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const data = await getLead(id);
  if (!data) notFound();
  const { lead, org, deals } = data;
  const [people, timeline, fieldOpts] = await Promise.all([listUsers(), getTimeline({ contactId: lead.id }), getFieldOptions()]);
  const userOptions = people.map((u) => ({ value: u.id, label: u.name }));
  const status = LEAD_STATUSES.find((s) => s.key === lead.leadStatus);
  const total = bantTotal(lead);

  return (
    <>
      <PageHeader
        title={lead.name}
        subtitle={
          <Group gap="xs">
            {org && (
              <AnchorLink href={`/companies/${org.id}`} fw={700} size="sm">
                {org.name}
              </AnchorLink>
            )}
            {lead.designation && (
              <Text size="sm" c="dimmed">
                {lead.designation}
              </Text>
            )}
            {status && <LeadStatusBadge kind={status.kind} label={status.label} />}
            {lead.leadStage && <Badge color="gray">{LEAD_STAGES[lead.leadStage as keyof typeof LEAD_STAGES] ?? lead.leadStage}</Badge>}
          </Group>
        }
        actions={
          <Group gap="xl">
            <Stat label="BANT" value={total ?? "—"} align="right" />
            <Stat label="SDR" value={people.find((p) => p.id === lead.sdrId)?.name ?? "—"} align="right" />
            <Stat label="AE" value={people.find((p) => p.id === lead.ownerId)?.name ?? "—"} align="right" />
          </Group>
        }
      />

      <Stack gap="lg">
        <Section
          title="Status"
          actions={
            <Text size="xs" c="dimmed">
              Qualified meeting or SQL opens a deal for the company
            </Text>
          }
        >
          <StageMover
            action={moveLeadAction}
            hidden={{ contactId: lead.id }}
            stages={LEAD_STATUSES.map((s) => ({
              key: s.key,
              name: s.label,
              kind: s.kind,
              current: s.key === lead.leadStatus,
              missing: s.key === lead.leadStatus ? [] : leadStatusMissing(lead, s.key as LeadStatus),
            }))}
          />
        </Section>

        <Grid gap="lg">
          <GridCol span={{ base: 12, lg: 8 }}>
            <Section title="Lead details">
              <ActionForm action={saveLeadAction} resultPosition="top">
                <input type="hidden" name="contactId" value={lead.id} />
                <Stack gap="md">
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <TextInput name="name" label="Name" defaultValue={lead.name} required />
                    <TextInput name="designation" label="Designation" defaultValue={lead.designation ?? ""} />
                    <TextInput name="email" label="Email" type="email" defaultValue={lead.email ?? ""} />
                    <TextInput name="phone" label="Phone" defaultValue={lead.phone ?? ""} />
                    <TextInput name="linkedinUrl" label="LinkedIn" type="url" defaultValue={lead.linkedinUrl ?? ""} />
                    <Checkbox name="isDecisionMaker" label="Decision maker" defaultChecked={lead.isDecisionMaker} mt={{ sm: 30 }} />
                  </SimpleGrid>

                  <Divider label="Ownership & source" labelPosition="left" />
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <Select name="sdrId" label="SDR" defaultValue={lead.sdrId} clearable data={userOptions} />
                    <Select
                      name="ownerId"
                      label="Account Executive"
                      description="Hand over to the AE once the meeting is booked"
                      defaultValue={lead.ownerId}
                      clearable
                      data={userOptions}
                    />
                    <Select name="source" label="Source" defaultValue={lead.source} clearable searchable data={selectData(fieldOpts, "source", lead.source)} />
                    <Select name="partnerName" label="Partner" defaultValue={lead.partnerName} clearable searchable data={selectData(fieldOpts, "partner", lead.partnerName)} />
                    <Select name="leadStage" label="Lead stage (marketing)" defaultValue={lead.leadStage} clearable data={options(LEAD_STAGES)} />
                  </SimpleGrid>

                  <Divider label="Meeting & qualification" labelPosition="left" />
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <DateField name="meetingScheduledAt" label="Meeting date" defaultValue={lead.meetingScheduledAt ?? ""} />
                    <DateField name="meetingCompletedAt" label="Meeting completed" defaultValue={lead.meetingCompletedAt ?? ""} />
                  </SimpleGrid>
                  <MultiSelect
                    name="productInterest"
                    label="Product interest"
                    description="What was pitched; becomes the deal's products"
                    defaultValue={lead.productInterest}
                    data={selectData(fieldOpts, "products", lead.productInterest)}
                    clearable
                  />
                  <BantFields
                    initial={{
                      bantBudget: lead.bantBudget,
                      bantAuthority: lead.bantAuthority,
                      bantNeed: lead.bantNeed,
                      bantTimeline: lead.bantTimeline,
                    }}
                  />
                  <Textarea
                    name="disqualifiedReason"
                    label="Disqualification reason"
                    description="Needed to mark the lead disqualified"
                    defaultValue={lead.disqualifiedReason ?? ""}
                  />
                  <Group>
                    <SubmitButton>Save lead</SubmitButton>
                  </Group>
                </Stack>
              </ActionForm>
            </Section>
          </GridCol>

          <GridCol span={{ base: 12, lg: 4 }}>
            <Stack gap="lg">
              {org && (
                <Section title="Company">
                  <Group justify="space-between" mb="xs">
                    <AnchorLink href={`/companies/${org.id}`} fw={700}>
                      {org.name}
                    </AnchorLink>
                    <LifecycleBadge lifecycle={org.lifecycle} label={LIFECYCLE_LABEL[org.lifecycle]} />
                  </Group>
                  {deals.length === 0 ? (
                    <Empty compact>No deals yet</Empty>
                  ) : (
                    <Stack gap={0}>
                      {deals.map((d) => (
                        <ButtonLink
                          key={d.id}
                          href={`/deals/${d.id}`}
                          className={classes.card}
                          style={{ border: 0, borderTop: "1px solid var(--mantine-color-default-border)", borderRadius: 0 }}
                        >
                          <Group justify="space-between" wrap="nowrap">
                            <div style={{ minWidth: 0 }}>
                              <Text size="sm" fw={700}>
                                {d.title}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {d.stageName} · {inr(d.mrr)}/mo
                              </Text>
                            </div>
                            <Group gap={6} wrap="nowrap">
                              <StatusBadge status={d.status} />
                              <ChevronRight size={16} color="var(--mantine-color-dimmed)" />
                            </Group>
                          </Group>
                        </ButtonLink>
                      ))}
                    </Stack>
                  )}
                  <Text size="xs" c="dimmed" mt="xs">
                    Qualified {shortDate(lead.qualifiedAt)} · SQL {shortDate(lead.sqlAt)}
                  </Text>
                </Section>
              )}
              <Section title="Activity & history">
                {org ? (
                  <Timeline items={timeline} orgId={org.id} contactId={lead.id} assignees={userOptions} />
                ) : (
                  <Empty compact>Link this lead to a company to log activity</Empty>
                )}
              </Section>
            </Stack>
          </GridCol>
        </Grid>
      </Stack>
    </>
  );
}
