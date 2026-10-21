import { Button, Card, Grid, GridCol, Select, SimpleGrid, Stack, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, TextInput } from "@mantine/core";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createOrganizationAction } from "@/app/actions";
import classes from "@/components/board.module.css";
import { ActionForm, SubmitButton } from "@/components/forms";
import { LifecycleBadge, MetricCard, PageHeader, Section } from "@/components/ui";
import { inr, LIFECYCLE_LABEL, SEGMENT_LABEL } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { listOrganizations, listUsers } from "@/server/queries";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  await getCurrentUser();
  const [orgs, people] = await Promise.all([listOrganizations(), listUsers()]);
  const customers = orgs.filter((o) => o.lifecycle === "active" || o.lifecycle === "onboarding" || o.lifecycle === "on_hold");
  const bookMrr = customers.reduce((a, o) => a + o.contractedMrr, 0);

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
        <MetricCard label="Customers" value={customers.length} hint="Onboarding, active or on hold" />
        <MetricCard label="Contracted MRR" value={inr(bookMrr)} />
        <MetricCard label="Active" value={orgs.filter((o) => o.lifecycle === "active").length} />
        <MetricCard label="Prospects" value={orgs.filter((o) => o.lifecycle === "prospect").length} />
      </SimpleGrid>
      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 9 }}>
          <Card withBorder p={0}>
            <TableScrollContainer minWidth={760}>
              <Table highlightOnHover>
                <TableThead>
                  <TableTr>
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
          </Card>
        </GridCol>
        <GridCol span={{ base: 12, lg: 3 }}>
          <Section title="New company">
            <ActionForm action={createOrganizationAction}>
              <Stack gap="sm">
                <TextInput name="name" label="Name" required />
                <TextInput name="website" label="Website" type="url" placeholder="https://" />
                <Select
                  name="aeId"
                  label="Account Executive"
                  placeholder="Pick a person"
                  clearable
                  data={people.map((p) => ({ value: p.id, label: p.name }))}
                />
                <SubmitButton fullWidth>Create company</SubmitButton>
              </Stack>
            </ActionForm>
          </Section>
        </GridCol>
      </Grid>
    </>
  );
}
