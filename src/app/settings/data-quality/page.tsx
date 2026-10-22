import { Badge, Group, SimpleGrid, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { AnchorLink, LinkButton } from "@/components/links";
import { Empty, LifecycleBadge, MetricCard, PageHeader, Section } from "@/components/ui";
import { PICKLISTS } from "@/domain/fields";
import { inr, LIFECYCLE_LABEL } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { duplicateCompanies, duplicateContacts, formatFixes } from "@/server/data-quality";
import { offListValues } from "@/server/fields";
import { tidyFormatsAction } from "./actions";
import { MergeButton } from "./merge-button";

export const metadata: Metadata = { title: "Data quality" };

// Long lists help nobody; the biggest problems first, then fix and reload.
const GROUP_LIMIT = 25;
const FIELD_LABEL = { website: "Website", email: "Email", phone: "Phone", name: "Name" } as const;

export default async function DataQualityPage() {
  const user = await getCurrentUser();
  if (user.role !== "admin") notFound();
  const [fixes, companyDupes, contactDupes, offList] = await Promise.all([
    formatFixes(),
    duplicateCompanies(),
    duplicateContacts(),
    Promise.all(PICKLISTS.map(async (p) => ({ p, values: await offListValues(p.key) }))),
  ]);
  const offTotal = offList.reduce((a, o) => a + o.values.reduce((b, v) => b + v.count, 0), 0);

  return (
    <>
      <PageHeader
        title="Data quality"
        subtitle="Formatting that isn't standard yet, duplicates to merge, and dropdown values that aren't on the list. New saves are already standardised; this cleans up what came before."
      />
      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        <MetricCard label="Formatting fixes" value={fixes.length} hint="Websites, emails, phones, names" />
        <MetricCard label="Duplicate companies" value={companyDupes.length} hint="Groups" />
        <MetricCard label="Duplicate people" value={contactDupes.length} hint="Groups (same email)" />
        <MetricCard label="Off-list values" value={offTotal} hint="Records" />
      </SimpleGrid>

      <Stack gap="lg">
        <Section
          title="Formatting"
          actions={
            fixes.length > 0 && (
              <ActionForm action={tidyFormatsAction}>
                <SubmitButton size="xs">Tidy all {fixes.length}</SubmitButton>
              </ActionForm>
            )
          }
        >
          {fixes.length === 0 ? (
            <Empty compact>Everything is in the standard format</Empty>
          ) : (
            <>
              <Text size="sm" c="dimmed" mb="sm">
                Websites become bare domains (so companies match by domain), emails lower case, Indian phone numbers +91…, and extra spaces go. Nothing else
                changes. A sample:
              </Text>
              <TableScrollContainer minWidth={560}>
                <Table>
                  <TableThead>
                    <TableTr>
                      <TableTh>Field</TableTh>
                      <TableTh>Now</TableTh>
                      <TableTh>Becomes</TableTh>
                    </TableTr>
                  </TableThead>
                  <TableTbody>
                    {fixes.slice(0, 8).map((f) => (
                      <TableTr key={`${f.id}-${f.field}`}>
                        <TableTd>{FIELD_LABEL[f.field]}</TableTd>
                        <TableTd c="dimmed">{f.from}</TableTd>
                        <TableTd fw={600}>{f.to}</TableTd>
                      </TableTr>
                    ))}
                  </TableTbody>
                </Table>
              </TableScrollContainer>
            </>
          )}
        </Section>

        <Section title={`Duplicate companies (${companyDupes.length})`}>
          {companyDupes.length === 0 ? (
            <Empty compact>No duplicate companies</Empty>
          ) : (
            <Stack gap="md">
              {companyDupes.slice(0, GROUP_LIMIT).map((g) => (
                <div key={g.records.map((r) => r.id).join()}>
                  <Text size="xs" c="dimmed" fw={600} mb={4}>
                    {g.reason}
                  </Text>
                  <TableScrollContainer minWidth={620}>
                    <Table withTableBorder>
                      <TableTbody>
                        {g.records.map((r) => (
                          <TableTr key={r.id}>
                            <TableTd>
                              <AnchorLink href={`/companies/${r.id}`} size="sm" fw={600}>
                                {r.name}
                              </AnchorLink>
                              <Text size="xs" c="dimmed">
                                {r.website ?? "No website"}
                              </Text>
                            </TableTd>
                            <TableTd>
                              <LifecycleBadge lifecycle={r.lifecycle} label={LIFECYCLE_LABEL[r.lifecycle]} />
                            </TableTd>
                            <TableTd ta="right">{inr(r.contractedMrr)}</TableTd>
                            <TableTd c="dimmed">
                              {r.deals} deals · {r.contacts} people
                            </TableTd>
                            <TableTd ta="right">
                              <MergeButton
                                kind="company"
                                drop={{ id: r.id, name: r.name }}
                                keepOptions={g.records.filter((x) => x.id !== r.id).map((x) => ({ value: x.id, label: `${x.name} (${x.deals} deals)` }))}
                              />
                            </TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                </div>
              ))}
              {companyDupes.length > GROUP_LIMIT && (
                <Text size="xs" c="dimmed">
                  And {companyDupes.length - GROUP_LIMIT} more groups.
                </Text>
              )}
            </Stack>
          )}
        </Section>

        <Section title={`Duplicate people (${contactDupes.length})`}>
          {contactDupes.length === 0 ? (
            <Empty compact>No two people share an email</Empty>
          ) : (
            <Stack gap="md">
              {contactDupes.slice(0, GROUP_LIMIT).map((g) => (
                <div key={g.reason}>
                  <Text size="xs" c="dimmed" fw={600} mb={4}>
                    {g.reason}
                  </Text>
                  <Table withTableBorder>
                    <TableTbody>
                      {g.records.map((r) => (
                        <TableTr key={r.id}>
                          <TableTd>
                            <AnchorLink href={`/leads/${r.id}`} size="sm" fw={600}>
                              {r.name}
                            </AnchorLink>
                          </TableTd>
                          <TableTd c="dimmed">{r.orgName ?? "—"}</TableTd>
                          <TableTd ta="right">
                            <MergeButton
                              kind="contact"
                              drop={{ id: r.id, name: r.name }}
                              keepOptions={g.records
                                .filter((x) => x.id !== r.id)
                                .map((x) => ({ value: x.id, label: `${x.name}${x.orgName ? ` · ${x.orgName}` : ""}` }))}
                            />
                          </TableTd>
                        </TableTr>
                      ))}
                    </TableTbody>
                  </Table>
                </div>
              ))}
            </Stack>
          )}
        </Section>

        <Section
          title="Dropdown values not on the list"
          actions={
            <LinkButton href="/settings/fields" size="xs" variant="default">
              Fix in Fields
            </LinkButton>
          }
        >
          {offTotal === 0 ? (
            <Empty compact>Every dropdown value is on its list</Empty>
          ) : (
            <Group gap="xs">
              {offList
                .filter((o) => o.values.length)
                .map((o) => (
                  <Badge key={o.p.key} color="yellow" size="lg">
                    {o.p.label}: {o.values.reduce((a, v) => a + v.count, 0)} records, {o.values.length} values
                  </Badge>
                ))}
            </Group>
          )}
        </Section>

        <Text size="sm" c="dimmed">
          Required fields missing on deals and leads are in the <AnchorLink href="/reports#hygiene">CRM hygiene report</AnchorLink>.
        </Text>
      </Stack>
    </>
  );
}
