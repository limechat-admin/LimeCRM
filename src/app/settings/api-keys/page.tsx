import {
  Badge,
  Card,
  Code,
  Grid,
  GridCol,
  Group,
  List,
  ListItem,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from "@mantine/core";
import type { Metadata } from "next";
import { Empty, PageHeader, Section } from "@/components/ui";
import { canManageApiKeys } from "@/domain/api-keys";
import { dateTime, shortDate } from "@/lib/format";
import { listApiKeys } from "@/server/api";
import { getCurrentUser } from "@/server/auth";
import { listUsers } from "@/server/queries";
import { CreateKeyForm, RevokeKeyButton } from "./key-forms";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const user = await getCurrentUser();
  const allowed = canManageApiKeys(user.role);
  if (!allowed.ok) {
    return (
      <>
        <PageHeader title="API keys" />
        <Card withBorder>
          <Empty>{allowed.message}</Empty>
        </Card>
      </>
    );
  }

  const [keys, people] = await Promise.all([listApiKeys(), listUsers()]);
  const userOptions = people.map((u) => ({ value: u.id, label: `${u.name} · ${u.role}` }));
  const active = keys.filter((k) => !k.revokedAt).length;

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="One key per app or agent that reads or updates LimeCRM through the REST API or the MCP server."
      />
      <Grid gap="lg" mb="lg">
        <GridCol span={{ base: 12, md: 7 }}>
          <Section title="New key">
            <CreateKeyForm users={userOptions} defaultOwnerId={user.id} />
          </Section>
        </GridCol>
        <GridCol span={{ base: 12, md: 5 }}>
          <Section title="How keys work">
            <List size="sm" spacing={6}>
              <ListItem>
                Send it as <Code>Authorization: Bearer lcrm_…</Code> to <Code>/api/v1</Code> or the MCP server at <Code>/api/v1/mcp</Code>.
              </ListItem>
              <ListItem>A key can never do more than the user it acts as. Deactivating that user stops the key too.</ListItem>
              <ListItem>Won-deal billing stays Finance/Admin only, and stage gates apply as in the app.</ListItem>
              <ListItem>LimeCRM stores only a hash. A lost key can&apos;t be recovered: revoke it and create a new one.</ListItem>
            </List>
          </Section>
        </GridCol>
      </Grid>

      <Card withBorder p={0}>
        {keys.length === 0 ? (
          <Empty>No API keys yet</Empty>
        ) : (
          <TableScrollContainer minWidth={760}>
            <Table highlightOnHover>
              <TableThead>
                <TableTr>
                  <TableTh>Name</TableTh>
                  <TableTh>Acts as</TableTh>
                  <TableTh>Access</TableTh>
                  <TableTh>Key</TableTh>
                  <TableTh>Last used</TableTh>
                  <TableTh />
                </TableTr>
              </TableThead>
              <TableTbody>
                {keys.map((k) => (
                  <TableTr key={k.id} opacity={k.revokedAt ? 0.6 : 1}>
                    <TableTd>
                      <Text size="sm" fw={600}>
                        {k.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Created {shortDate(k.createdAt)}
                      </Text>
                    </TableTd>
                    <TableTd>
                      <Text size="sm">{k.ownerName}</Text>
                      <Group gap={4}>
                        <Text size="xs" c="dimmed">
                          {k.ownerRole}
                        </Text>
                        {!k.ownerActive && (
                          <Badge size="xs" color="red">
                            Deactivated
                          </Badge>
                        )}
                      </Group>
                    </TableTd>
                    <TableTd>
                      <Badge color={k.scopes.includes("write") ? "lime" : "gray"}>
                        {k.scopes.includes("write") ? "Read and write" : "Read only"}
                      </Badge>
                    </TableTd>
                    <TableTd>
                      <Code>{k.keyPrefix}…</Code>
                    </TableTd>
                    <TableTd>
                      <Text size="sm">{k.lastUsedAt ? dateTime(k.lastUsedAt) : "Never"}</Text>
                    </TableTd>
                    <TableTd ta="right">
                      {k.revokedAt ? (
                        <Badge color="red" variant="light">
                          Revoked {shortDate(k.revokedAt)}
                        </Badge>
                      ) : (
                        <RevokeKeyButton keyId={k.id} name={k.name} />
                      )}
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        )}
      </Card>
      <Text size="xs" c="dimmed" mt="xs">
        {active} active {active === 1 ? "key" : "keys"}. Revoked keys stay listed for the audit trail.
      </Text>
    </>
  );
}
