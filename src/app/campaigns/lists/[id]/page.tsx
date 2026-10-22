import { Button, Grid, GridCol, Table, TableScrollContainer, TableTbody, TableTd, TableTr, Text } from "@mantine/core";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnchorLink } from "@/components/links";
import { Empty, PageHeader, Section } from "@/components/ui";
import { db } from "@/db";
import { emailLists } from "@/db/schema";
import { listFiltersSchema } from "@/domain/campaigns";
import { LEAD_STATUSES } from "@/domain/leads";
import { isUuid } from "@/lib/ids";
import { LIFECYCLE_LABEL, SEGMENT_LABEL } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { listMembers } from "@/server/campaigns";
import { getFieldOptions } from "@/server/fields";
import { listUsers } from "@/server/queries";
import { deleteListAction } from "../../actions";
import { ListEditor, type FilterOptions } from "./list-editor";

export const metadata: Metadata = { title: "List" };

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  await getCurrentUser();
  const { id } = await params;
  const isNew = id === "new";
  if (!isNew && !isUuid(id)) notFound();
  const [list] = isNew ? [] : await db.select().from(emailLists).where(eq(emailLists.id, id));
  if (!isNew && !list) notFound();
  const filters = listFiltersSchema.parse(list?.filters ?? {});
  const [people, fields, members] = await Promise.all([listUsers(), getFieldOptions(), list ? listMembers(filters, 25) : Promise.resolve(null)]);
  const values = (k: keyof typeof fields) => fields[k].filter((o) => !o.retired).map((o) => ({ value: o.value, label: o.value }));
  const options: FilterOptions = {
    leadStatuses: LEAD_STATUSES.map((s) => ({ value: s.key, label: s.label })),
    users: people.map((p) => ({ value: p.id, label: p.name })),
    sources: values("source"),
    products: values("products"),
    industries: values("industry"),
    trafficBands: values("traffic_band"),
    lifecycles: Object.entries(LIFECYCLE_LABEL).map(([value, label]) => ({ value, label })),
    segments: Object.entries(SEGMENT_LABEL).map(([value, label]) => ({ value, label })),
  };
  return (
    <>
      <PageHeader
        title={list?.name ?? "New list"}
        subtitle={<AnchorLink href="/campaigns/lists">All lists</AnchorLink>}
        actions={
          list && (
            <form action={deleteListAction}>
              <input type="hidden" name="id" value={list.id} />
              <Button type="submit" size="xs" variant="subtle" color="red">
                Delete list
              </Button>
            </form>
          )
        }
      />
      <Grid gap="lg">
        <GridCol span={{ base: 12, lg: 7 }}>
          <ListEditor id={list?.id ?? null} name={list?.name ?? ""} filters={filters} options={options} />
        </GridCol>
        <GridCol span={{ base: 12, lg: 5 }}>
          <Section title={members ? `${members.total.toLocaleString("en-IN")} people` : "Who's in it"}>
            {!members ? (
              <Empty compact>Create the list to see who matches</Empty>
            ) : members.rows.length === 0 ? (
              <Empty compact>Nobody with an email matches</Empty>
            ) : (
              <>
                <TableScrollContainer minWidth={360}>
                  <Table>
                    <TableTbody>
                      {members.rows.map((m) => (
                        <TableTr key={m.email}>
                          <TableTd>
                            <AnchorLink href={`/leads/${m.contactId}`} size="sm">
                              {m.name}
                            </AnchorLink>
                            <Text size="xs" c="dimmed">
                              {m.email}
                            </Text>
                          </TableTd>
                          <TableTd c="dimmed">{m.company ?? "—"}</TableTd>
                        </TableTr>
                      ))}
                    </TableTbody>
                  </Table>
                </TableScrollContainer>
                {members.total > members.rows.length && (
                  <Text size="xs" c="dimmed" mt="xs">
                    And {(members.total - members.rows.length).toLocaleString("en-IN")} more. People who unsubscribed or bounced are skipped when sending.
                  </Text>
                )}
              </>
            )}
          </Section>
        </GridCol>
      </Grid>
    </>
  );
}
