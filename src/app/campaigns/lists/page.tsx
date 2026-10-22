import { Card, Table, TableScrollContainer, TableTbody, TableTd, TableTh, TableThead, TableTr, Text } from "@mantine/core";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { AnchorLink, LinkButton } from "@/components/links";
import { Empty, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { emailLists } from "@/db/schema";
import { describeFilters, listFiltersSchema } from "@/domain/campaigns";
import { canWrite } from "@/domain/permissions";
import { getCurrentUser } from "@/server/auth";
import { listMembers } from "@/server/campaigns";
import { listUsers } from "@/server/queries";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const user = await getCurrentUser();
  const [lists, people] = await Promise.all([db.select().from(emailLists).orderBy(emailLists.name), listUsers()]);
  const name = (_: "user", id: string) => people.find((p) => p.id === id)?.name ?? "someone";
  const withCounts = await Promise.all(
    lists.map(async (l) => ({ l, f: listFiltersSchema.parse(l.filters), total: (await listMembers(listFiltersSchema.parse(l.filters), 1)).total })),
  );
  return (
    <>
      <PageHeader
        title="Lists"
        subtitle={
          <>
            <AnchorLink href="/campaigns">Campaigns</AnchorLink> · Lists update themselves: whoever matches the filters when a campaign is sent gets it.
          </>
        }
        actions={
          canWrite(user.role).ok && (
            <LinkButton href="/campaigns/lists/new" size="xs" leftSection={<Plus size={14} />}>
              New list
            </LinkButton>
          )
        }
      />
      <Card withBorder p={0}>
        {withCounts.length === 0 ? (
          <Empty>No lists yet</Empty>
        ) : (
          <TableScrollContainer minWidth={640}>
            <Table highlightOnHover>
              <TableThead>
                <TableTr>
                  <TableTh>List</TableTh>
                  <TableTh>Who</TableTh>
                  <TableTh ta="right">People</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {withCounts.map(({ l, f, total }) => (
                  <TableTr key={l.id}>
                    <TableTd>
                      <AnchorLink href={`/campaigns/lists/${l.id}`} size="sm" fw={700} c="var(--mantine-color-text)">
                        {l.name}
                      </AnchorLink>
                    </TableTd>
                    <TableTd>
                      <Text size="sm" c="dimmed">
                        {describeFilters(f, name)}
                      </Text>
                    </TableTd>
                    <TableTd ta="right">{total.toLocaleString("en-IN")}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        )}
      </Card>
    </>
  );
}
