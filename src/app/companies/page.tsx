import {
  Button,
  Card,
  Checkbox,
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
import { Download, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createOrganizationAction } from "@/app/actions";
import { bulkCompaniesAction } from "@/app/bulk-actions";
import classes from "@/components/board.module.css";
import { BulkBar, BulkCheckbox, BulkHeaderCheckbox, BulkProvider } from "@/components/bulk-edit";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LinkButton } from "@/components/links";
import { Empty, LifecycleBadge, MetricCard, PageHeader, Section } from "@/components/ui";
import { CLEAR } from "@/domain/bulk";
import { canWrite } from "@/domain/permissions";
import { RECONNECT_PRESETS } from "@/domain/reconnect";
import { inr, LIFECYCLE_LABEL, SEGMENT_LABEL } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { listOrganizations, listUsers, organizationSummary, type OrgFilters } from "@/server/queries";

export const metadata: Metadata = { title: "Companies" };

// Thousands of prospects after the Salesmate import: show the biggest, and filter for the rest.
const PAGE_SIZE = 200;

function href(current: OrgFilters, change: Partial<OrgFilters>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...change })) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `/companies?${qs}` : "/companies";
}

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<OrgFilters> }) {
  const user = await getCurrentUser();
  const filters = await searchParams;
  const [orgs, summary, people] = await Promise.all([listOrganizations(filters, PAGE_SIZE), organizationSummary(), listUsers()]);
  const userOptions = people.map((p) => ({ value: p.id, label: p.name }));
  const bulkPeople = [{ value: CLEAR, label: "Nobody" }, ...userOptions];
  const editable = canWrite(user.role).ok;
  const filtered = !!(filters.q || filters.lifecycle || filters.aeId);

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle="One record per customer: lifecycle, owners and contracted MRR."
        actions={
          <Button component="a" href="/export/companies.csv" variant="default" size="xs" leftSection={<Download size={14} />}>
            Export CSV
          </Button>
        }
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Customers" value={summary.customers} hint="Onboarding, active or on hold" />
        <MetricCard label="Contracted MRR" value={inr(summary.bookMrr)} />
        <MetricCard label="Active" value={summary.active} />
        <MetricCard label="Prospects" value={summary.prospects} />
      </SimpleGrid>
      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 9 }}>
          <Stack gap="sm">
            {/* GET form: filters live in the URL */}
            <form action="/companies">
              {filters.lifecycle && <input type="hidden" name="lifecycle" value={filters.lifecycle} />}
              <Group gap="sm" align="flex-end" wrap="wrap">
                <TextInput
                  name="q"
                  defaultValue={filters.q ?? ""}
                  placeholder="Search name or website"
                  leftSection={<Search size={16} />}
                  style={{ flex: 1, minWidth: 220 }}
                  aria-label="Search companies"
                />
                <Select
                  name="aeId"
                  placeholder="Any AE"
                  clearable
                  defaultValue={filters.aeId ?? null}
                  data={[{ value: "none", label: "No AE" }, ...userOptions]}
                  w={170}
                  aria-label="AE"
                />
                <SubmitButton variant="default">Filter</SubmitButton>
              </Group>
            </form>
            <Group gap={6}>
              <LinkButton href={href(filters, { lifecycle: undefined })} size="xs" variant={filters.lifecycle ? "default" : "filled"}>
                All
              </LinkButton>
              {Object.entries(LIFECYCLE_LABEL).map(([key, label]) => (
                <LinkButton key={key} href={href(filters, { lifecycle: key })} size="xs" variant={filters.lifecycle === key ? "filled" : "default"}>
                  {label}
                </LinkButton>
              ))}
            </Group>

            <BulkProvider allIds={orgs.map((o) => o.id)}>
              <Card withBorder p={0}>
                {orgs.length === 0 ? (
                  <Empty>No companies match these filters</Empty>
                ) : (
                  <TableScrollContainer minWidth={760}>
                    <Table highlightOnHover>
                      <TableThead>
                        <TableTr>
                          {editable && (
                            <TableTh w={36}>
                              <BulkHeaderCheckbox />
                            </TableTh>
                          )}
                          <TableTh>Company</TableTh>
                          <TableTh>Lifecycle</TableTh>
                          <TableTh>Segment</TableTh>
                          <TableTh ta="right">Contracted MRR</TableTh>
                          <TableTh>AE</TableTh>
                          <TableTh>CSM</TableTh>
                          <TableTh>LC account</TableTh>
                        </TableTr>
                      </TableThead>
                      <TableTbody>
                        {orgs.map((o) => (
                          <TableTr key={o.id}>
                            {editable && (
                              <TableTd>
                                <BulkCheckbox id={o.id} label={o.name} />
                              </TableTd>
                            )}
                            <TableTd>
                              <Link href={`/companies/${o.id}`} className={classes.rowLink}>
                                {o.name}
                              </Link>
                              {o.hqCity && (
                                <Text size="xs" c="dimmed">
                                  {o.hqCity}
                                </Text>
                              )}
                            </TableTd>
                            <TableTd>
                              <LifecycleBadge lifecycle={o.lifecycle} label={LIFECYCLE_LABEL[o.lifecycle]} />
                            </TableTd>
                            <TableTd c="dimmed">{o.segment ? SEGMENT_LABEL[o.segment] : "—"}</TableTd>
                            <TableTd ta="right" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                              {inr(o.contractedMrr)}
                            </TableTd>
                            <TableTd>{o.aeName ?? "—"}</TableTd>
                            <TableTd>{o.csmName ?? "—"}</TableTd>
                            <TableTd c="dimmed">{o.lcAccountIds.join(", ") || "—"}</TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                )}
              </Card>
              {editable && (
                <BulkBar action={bulkCompaniesAction} noun="companies">
                  <Select name="aeId" label="AE" placeholder="Keep" clearable searchable data={bulkPeople} w={160} />
                  <Checkbox name="moveDeals" label="Move their open deals too" size="xs" defaultChecked style={{ alignSelf: "center" }} />
                  <Select name="omId" label="Onboarding" placeholder="Keep" clearable searchable data={bulkPeople} w={160} />
                  <Select name="csmId" label="CSM" placeholder="Keep" clearable searchable data={bulkPeople} w={160} />
                  <Select
                    name="segment"
                    label="Segment"
                    placeholder="Keep"
                    clearable
                    data={[{ value: CLEAR, label: "No segment" }, ...Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label }))]}
                    w={170}
                  />
                  <Select
                    name="reconnect"
                    label="Reconnect"
                    placeholder="Keep"
                    clearable
                    data={[...RECONNECT_PRESETS.map((p) => ({ value: p.key, label: p.label })), { value: CLEAR, label: "Take off the list" }]}
                    w={160}
                  />
                </BulkBar>
              )}
            </BulkProvider>
            <Text size="xs" c="dimmed">
              {orgs.total > orgs.length
                ? `Showing the ${orgs.length} biggest of ${orgs.total}${filtered ? " matching" : ""}. Search or filter to find the rest.`
                : `${orgs.total} ${orgs.total === 1 ? "company" : "companies"}${filtered ? " match" : ""}.`}
            </Text>
          </Stack>
        </GridCol>
        <GridCol span={{ base: 12, lg: 3 }}>
          <Section title="New company">
            <ActionForm action={createOrganizationAction}>
              <Stack gap="sm">
                <TextInput name="name" label="Name" required />
                <TextInput name="website" label="Website" type="url" placeholder="https://" />
                <Select name="aeId" label="Account Executive" placeholder="Pick a person" clearable data={userOptions} />
                <SubmitButton fullWidth>Create company</SubmitButton>
              </Stack>
            </ActionForm>
          </Section>
        </GridCol>
      </Grid>
    </>
  );
}
