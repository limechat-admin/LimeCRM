import {
  ActionIcon,
  Button,
  Card,
  Grid,
  GridCol,
  Group,
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
  Text,
  TextInput,
} from "@mantine/core";
import { Download, Search, Upload, Users, X } from "lucide-react";
import type { Metadata } from "next";
import { createLeadAction, deleteViewAction } from "@/app/actions";
import { bulkLeadsAction } from "@/app/bulk-actions";
import { BulkBar, BulkCheckbox, BulkHeaderCheckbox, BulkProvider } from "@/components/bulk-edit";
import classes from "@/components/board.module.css";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { SaveViewButton } from "@/components/saved-views";
import { AnchorLink, LinkButton } from "@/components/links";
import { Empty, LeadStatusBadge, MetricCard, PageHeader, Section } from "@/components/ui";
import { bantTotal, LEAD_STATUSES, type LeadStatus } from "@/domain/leads";
import { shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { listLeads, listUsers, listViews, type LeadFilters } from "@/server/queries";
import { CLEAR } from "@/domain/bulk";
import { canWrite } from "@/domain/permissions";
import { cleanViewQuery, viewHref } from "@/domain/views";
import { getFieldOptions, selectData } from "@/server/fields";

export const metadata: Metadata = { title: "Leads" };

const STATUS = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s])) as Record<LeadStatus, (typeof LEAD_STATUSES)[number]>;

/** Build a /leads URL that keeps the other filters. */
function href(current: LeadFilters, change: Partial<LeadFilters>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...change })) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `/leads?${qs}` : "/leads";
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<LeadFilters> }) {
  const user = await getCurrentUser();
  const filters = await searchParams;
  const [{ rows, byStatus, pageSize }, people, views, fieldOpts] = await Promise.all([listLeads(filters), listUsers(), listViews("leads", user.id), getFieldOptions()]);
  const currentQuery = cleanViewQuery(
    "leads",
    new URLSearchParams(Object.entries(filters).filter(([, v]) => typeof v === "string") as [string, string][]).toString(),
  );
  const userOptions = people.map((u) => ({ value: u.id, label: u.name }));
  const total = Object.values(byStatus).reduce((a, n) => a + n, 0);
  const editable = canWrite(user.role).ok;
  const bulkPeople = [{ value: CLEAR, label: "Nobody" }, ...userOptions];
  const working = ["not_contacted", "attempted_contact", "ongoing", "meeting_scheduled"].reduce((a, k) => a + (byStatus[k] ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="People the SDRs are working, from first touch to qualified meeting and SQL."
        actions={
          <Group gap="xs">
            <Button
              component="a"
              href={`/export/leads.csv${href(filters, {}).replace("/leads", "")}`}
              variant="default"
              size="xs"
              leftSection={<Download size={14} />}
            >
              Export CSV
            </Button>
            <LinkButton href="/leads/import" size="xs" leftSection={<Upload size={14} />}>
              Import CSV
            </LinkButton>
          </Group>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Leads" value={total} hint={filters.ownerId || filters.sdrId || filters.q ? "Matching filters" : undefined} />
        <MetricCard label="Being worked" value={working} hint="Not contacted → meeting scheduled" />
        <MetricCard label="Qualified meetings" value={byStatus.qualified_meeting ?? 0} />
        <MetricCard label="SQLs" value={byStatus.sql ?? 0} />
      </SimpleGrid>

      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 9 }}>
          <Stack gap="sm">
            {/* GET form: filters live in the URL, so views are shareable links */}
            <form action="/leads">
              {filters.status && <input type="hidden" name="status" value={filters.status} />}
              <Group gap="sm" align="flex-end" wrap="wrap">
                <TextInput
                  name="q"
                  defaultValue={filters.q ?? ""}
                  placeholder="Search name, email or company"
                  leftSection={<Search size={16} />}
                  style={{ flex: 1, minWidth: 220 }}
                  aria-label="Search leads"
                />
                <Select name="ownerId" placeholder="Any AE" clearable defaultValue={filters.ownerId ?? null} data={userOptions} w={170} aria-label="Owner" />
                <Select name="sdrId" placeholder="Any SDR" clearable defaultValue={filters.sdrId ?? null} data={userOptions} w={170} aria-label="SDR" />
                <SubmitButton variant="default">Filter</SubmitButton>
              </Group>
            </form>

            <Group gap={6} align="center">
              <Text size="xs" c="dimmed" fw={600}>
                Views
              </Text>
              {views.length === 0 && (
                <Text size="xs" c="dimmed">
                  None yet. Filter the list, then save it.
                </Text>
              )}
              {views.map((v) => (
                <Group key={v.id} gap={2} wrap="nowrap">
                  <LinkButton
                    href={viewHref("leads", v.query)}
                    size="xs"
                    variant={v.query === currentQuery ? "filled" : "light"}
                    leftSection={v.shared ? <Users size={12} /> : undefined}
                  >
                    {v.name}
                    {v.shared && v.ownerId !== user.id ? ` · ${v.ownerName.split(" ")[0]}` : ""}
                  </LinkButton>
                  {(v.ownerId === user.id || user.role === "admin") && (
                    <InlineAction action={deleteViewAction} hidden={{ viewId: v.id }}>
                      <ActionIcon type="submit" size="xs" aria-label={`Delete view ${v.name}`}>
                        <X size={12} />
                      </ActionIcon>
                    </InlineAction>
                  )}
                </Group>
              ))}
              <SaveViewButton module="leads" query={currentQuery} canShare={canWrite(user.role).ok} />
            </Group>

            <Group gap={6}>
              <LinkButton href={href(filters, { status: undefined })} size="xs" variant={filters.status ? "default" : "filled"}>
                All {total}
              </LinkButton>
              {LEAD_STATUSES.map((s) => (
                <LinkButton key={s.key} href={href(filters, { status: s.key })} size="xs" variant={filters.status === s.key ? "filled" : "default"}>
                  {s.label} {byStatus[s.key] ?? 0}
                </LinkButton>
              ))}
              {(byStatus.none ?? 0) > 0 && (
                <LinkButton href={href(filters, { status: "none" })} size="xs" variant={filters.status === "none" ? "filled" : "default"}>
                  No status {byStatus.none}
                </LinkButton>
              )}
            </Group>

            <BulkProvider allIds={rows.map((r) => r.c.id)}>
              <Card withBorder p={0}>
                {rows.length === 0 ? (
                  <Empty>No leads match these filters</Empty>
                ) : (
                  <TableScrollContainer minWidth={820}>
                    <Table highlightOnHover>
                      <TableThead>
                        <TableTr>
                          {editable && (
                            <TableTh w={36}>
                              <BulkHeaderCheckbox />
                            </TableTh>
                          )}
                          <TableTh>Lead</TableTh>
                          <TableTh>Company</TableTh>
                          <TableTh miw={180}>Status</TableTh>
                          <TableTh ta="right">BANT</TableTh>
                          <TableTh>AE</TableTh>
                          <TableTh>SDR</TableTh>
                          <TableTh>Source</TableTh>
                          <TableTh>Updated</TableTh>
                        </TableTr>
                      </TableThead>
                      <TableTbody>
                        {rows.map(({ c, orgName, ownerName, sdrName }) => {
                          const status = c.leadStatus ? STATUS[c.leadStatus as LeadStatus] : undefined;
                          return (
                            <TableTr key={c.id}>
                              {editable && (
                                <TableTd>
                                  <BulkCheckbox id={c.id} label={c.name} />
                                </TableTd>
                              )}
                              <TableTd>
                                <AnchorLink href={`/leads/${c.id}`} className={classes.rowLink} underline="never">
                                  {c.name}
                                </AnchorLink>
                                {c.designation && (
                                  <Text size="xs" c="dimmed">
                                    {c.designation}
                                  </Text>
                                )}
                              </TableTd>
                              <TableTd>
                                {c.orgId ? (
                                  <AnchorLink href={`/companies/${c.orgId}`} size="sm" c="var(--mantine-color-text)">
                                    {orgName}
                                  </AnchorLink>
                                ) : (
                                  "—"
                                )}
                              </TableTd>
                              <TableTd>{status ? <LeadStatusBadge kind={status.kind} label={status.label} /> : <Text c="dimmed">—</Text>}</TableTd>
                              <TableTd ta="right" fw={600}>
                                {bantTotal(c) ?? "—"}
                              </TableTd>
                              <TableTd>{ownerName ?? "—"}</TableTd>
                              <TableTd>{sdrName ?? "—"}</TableTd>
                              <TableTd c="dimmed">{c.source ?? "—"}</TableTd>
                              <TableTd c="dimmed">{shortDate(c.updatedAt)}</TableTd>
                            </TableTr>
                          );
                        })}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                )}
              </Card>
              {editable && (
                <BulkBar action={bulkLeadsAction} noun={rows.length === 1 ? "lead" : "leads"}>
                  <Select
                    name="status"
                    label="Status"
                    placeholder="Keep"
                    clearable
                    data={LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label }))}
                    w={180}
                  />
                  <Select name="sdrId" label="SDR" placeholder="Keep" clearable searchable data={bulkPeople} w={170} />
                  <Select name="ownerId" label="AE" placeholder="Keep" clearable searchable data={bulkPeople} w={170} />
                </BulkBar>
              )}
            </BulkProvider>
            {rows.length === pageSize && (
              <Text size="xs" c="dimmed">
                Showing the {pageSize} most recently updated. Narrow the filters to find older leads.
              </Text>
            )}
          </Stack>
        </GridCol>

        <GridCol span={{ base: 12, lg: 3 }}>
          <Section title="New lead">
            <ActionForm action={createLeadAction}>
              <Stack gap="sm">
                <TextInput name="name" label="Name" required />
                <TextInput name="companyName" label="Company" required description="Matches an existing company by name, or creates one" />
                <TextInput name="email" label="Work email" type="email" />
                <TextInput name="phone" label="Phone" />
                <TextInput name="designation" label="Designation" />
                <TextInput name="website" label="Website" placeholder="acme.in" />
                <Select
                  name="source"
                  label="Source"
                  clearable
                  data={selectData(fieldOpts, "source")}
                />
                <Select name="sdrId" label="SDR" clearable data={userOptions} />
                <Select name="ownerId" label="Account Executive" clearable data={userOptions} />
                <SubmitButton fullWidth>Create lead</SubmitButton>
              </Stack>
            </ActionForm>
          </Section>
        </GridCol>
      </Grid>
    </>
  );
}
