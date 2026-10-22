import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Grid,
  GridCol,
  Group,
  List,
  ListItem,
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
import { desc, eq } from "drizzle-orm";
import { Mail, X } from "lucide-react";
import type { Metadata } from "next";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { AnchorLink } from "@/components/links";
import { Empty, PageHeader, Section } from "@/components/ui";
import { db } from "@/db";
import { emailMessages, mailAccounts, mailExclusions, organizations, users } from "@/db/schema";
import { canWrite } from "@/domain/permissions";
import { dateTime, shortDate } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { gmailConfigured, redirectUri } from "@/server/gmail";
import { BACKFILL_DAYS } from "@/server/mail-sync";
import { addExclusionAction, disconnectAction, removeExclusionAction, syncNowAction, togglePauseAction } from "./actions";

export const metadata: Metadata = { title: "Email sync" };

const STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Syncing", color: "green" },
  paused: { label: "Paused", color: "gray" },
  error: { label: "Failing", color: "red" },
  revoked: { label: "Access removed", color: "red" },
};

const ERRORS: Record<string, string> = {
  not_configured: "Gmail sync isn't set up on this server yet. An admin needs to finish the Google setup below.",
  expired: "That took too long or came from another tab. Try connecting again.",
  no_token: "Google didn't return access. Try again, and approve every permission on Google's screen.",
  scope: "Gmail read access wasn't granted, so nothing was connected. Try again and tick the Gmail permission.",
  wrong_account: "Connect your own work mailbox (the one you sign in to LimeCRM with). The other account wasn't connected.",
  access_denied: "You cancelled on Google's screen. Nothing was connected.",
};

export default async function EmailSyncPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await getCurrentUser();
  const { connected, error } = await searchParams;
  const configured = gmailConfigured();
  const [[account], exclusions, team] = await Promise.all([
    db.select().from(mailAccounts).where(eq(mailAccounts.userId, user.id)),
    db.select().from(mailExclusions).orderBy(mailExclusions.value),
    user.role === "admin"
      ? db
          .select({
            name: users.name,
            email: mailAccounts.email,
            status: mailAccounts.status,
            lastSyncedAt: mailAccounts.lastSyncedAt,
            logged: mailAccounts.messagesLogged,
            lastError: mailAccounts.lastError,
          })
          .from(mailAccounts)
          .innerJoin(users, eq(users.id, mailAccounts.userId))
          .orderBy(users.name)
      : Promise.resolve([]),
  ]);
  const recent = account
    ? await db
        .select({ m: emailMessages, org: organizations.name })
        .from(emailMessages)
        .leftJoin(organizations, eq(organizations.id, emailMessages.orgId))
        .where(eq(emailMessages.accountId, account.id))
        .orderBy(desc(emailMessages.sentAt))
        .limit(15)
    : [];
  const status = account ? STATUS[account.status] : null;

  return (
    <>
      <PageHeader
        title="Email sync"
        subtitle="Emails between you and customers land on their timeline automatically, and new people you write to become contacts."
      />
      {connected && (
        <Alert color="lime" mb="lg" title="Gmail connected">
          The first sync brings in the last {BACKFILL_DAYS} days within a few minutes. Use Sync now to start it right away.
        </Alert>
      )}
      {error && (
        <Alert color="red" mb="lg">
          {ERRORS[error] ?? `Google said: ${error}`}
        </Alert>
      )}

      <Grid gap="lg">
        <GridCol span={{ base: 12, md: 7 }}>
          <Stack gap="lg">
            <Section title="Your mailbox">
              {!account ? (
                <Stack gap="sm">
                  <Text size="sm">Connect your Gmail once. From then on, LimeCRM checks it every few minutes.</Text>
                  <Button component="a" href="/api/gmail/connect" leftSection={<Mail size={16} />} disabled={!configured} w="fit-content">
                    Connect Gmail
                  </Button>
                </Stack>
              ) : (
                <Stack gap="sm">
                  <Group gap="sm">
                    <Text fw={700}>{account.email}</Text>
                    <Badge color={status?.color}>{status?.label}</Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {account.lastSyncedAt ? `Last synced ${dateTime(account.lastSyncedAt)}` : "Not synced yet"} ·{" "}
                    {account.messagesLogged.toLocaleString("en-IN")} emails logged
                  </Text>
                  {account.lastError && (
                    <Alert color="red" variant="light">
                      {account.status === "revoked"
                        ? "Google no longer allows access (it was removed in your Google account, or the password changed). Disconnect and connect again."
                        : account.lastError}
                    </Alert>
                  )}
                  <Group gap="xs">
                    <InlineAction action={syncNowAction} hidden={{}}>
                      <SubmitButton size="xs" disabled={account.status === "paused"}>
                        Sync now
                      </SubmitButton>
                    </InlineAction>
                    <InlineAction action={togglePauseAction} hidden={{}}>
                      <SubmitButton size="xs" variant="default">
                        {account.status === "paused" ? "Resume" : "Pause"}
                      </SubmitButton>
                    </InlineAction>
                    <InlineAction action={disconnectAction} hidden={{}}>
                      <SubmitButton size="xs" variant="subtle" color="red">
                        Disconnect
                      </SubmitButton>
                    </InlineAction>
                  </Group>
                </Stack>
              )}
            </Section>

            {account && (
              <Section title="Recently logged">
                {recent.length === 0 ? (
                  <Empty compact>Nothing logged yet</Empty>
                ) : (
                  <TableScrollContainer minWidth={400}>
                    <Table>
                      <TableTbody>
                        {recent.map(({ m, org }) => (
                          <TableTr key={m.id}>
                            <TableTd>
                              <Badge color={m.direction === "outbound" ? "lime" : "gray"}>{m.direction === "outbound" ? "Sent" : "Received"}</Badge>
                            </TableTd>
                            <TableTd>
                              <Text size="sm" fw={600} lineClamp={1}>
                                {m.subject}
                              </Text>
                              <Text size="xs" c="dimmed">
                                {m.orgId ? (
                                  <AnchorLink href={`/companies/${m.orgId}`} size="xs">
                                    {org}
                                  </AnchorLink>
                                ) : (
                                  m.participants.map((p) => p.email).join(", ")
                                )}
                              </Text>
                            </TableTd>
                            <TableTd c="dimmed" style={{ whiteSpace: "nowrap" }}>
                              {shortDate(m.sentAt)}
                            </TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                )}
              </Section>
            )}

            {user.role === "admin" && (
              <Section title="Team">
                {team.length === 0 ? (
                  <Empty compact>Nobody has connected Gmail yet</Empty>
                ) : (
                  <TableScrollContainer minWidth={520}>
                    <Table>
                      <TableThead>
                        <TableTr>
                          <TableTh>Person</TableTh>
                          <TableTh>Status</TableTh>
                          <TableTh>Last synced</TableTh>
                          <TableTh ta="right">Logged</TableTh>
                        </TableTr>
                      </TableThead>
                      <TableTbody>
                        {team.map((t) => (
                          <TableTr key={t.email}>
                            <TableTd>
                              <Text size="sm">{t.name}</Text>
                              <Text size="xs" c="dimmed">
                                {t.email}
                              </Text>
                            </TableTd>
                            <TableTd>
                              <Badge color={STATUS[t.status]?.color} title={t.lastError ?? undefined}>
                                {STATUS[t.status]?.label ?? t.status}
                              </Badge>
                            </TableTd>
                            <TableTd c="dimmed">{t.lastSyncedAt ? dateTime(t.lastSyncedAt) : "—"}</TableTd>
                            <TableTd ta="right">{t.logged.toLocaleString("en-IN")}</TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                )}
              </Section>
            )}
          </Stack>
        </GridCol>

        <GridCol span={{ base: 12, md: 5 }}>
          <Stack gap="lg">
            <Section title="What's logged">
              <List size="sm" spacing={6}>
                <ListItem>Emails between you and people outside LimeChat, in your inbox and sent mail.</ListItem>
                <ListItem>Someone new you email becomes a contact; their company is matched by domain, or created (not for gmail.com and the like).</ListItem>
                <ListItem>Emails from strangers are logged only once they&apos;re a contact, so recruiters and cold pitches stay out.</ListItem>
                <ListItem>Skipped: internal mail, newsletters, automated mail, mass emails, drafts, spam and the never-log list.</ListItem>
                <ListItem>Only the subject, people and a short snippet are kept. Never the full body or attachments.</ListItem>
              </List>
            </Section>

            <Section title="Never log">
              <Text size="xs" c="dimmed" mb="sm">
                Domains or addresses that are never logged for anyone: vendors, personal contacts, legal.
              </Text>
              {exclusions.length > 0 && (
                <Group gap={6} mb="sm">
                  {exclusions.map((x) => (
                    <Badge
                      key={x.id}
                      color="gray"
                      rightSection={
                        user.role === "admin" ? (
                          <InlineAction action={removeExclusionAction} hidden={{ value: x.value }}>
                            <ActionIcon type="submit" size="xs" variant="transparent" color="gray" aria-label={`Remove ${x.value}`}>
                              <X size={10} />
                            </ActionIcon>
                          </InlineAction>
                        ) : undefined
                      }
                    >
                      {x.value}
                    </Badge>
                  ))}
                </Group>
              )}
              {canWrite(user.role).ok && (
                <ActionForm action={addExclusionAction}>
                  <Group gap="xs" align="flex-end">
                    <TextInput
                      name="value"
                      placeholder="vendor.com or person@gmail.com"
                      aria-label="Domain or address to never log"
                      style={{ flex: 1 }}
                      required
                    />
                    <SubmitButton variant="default">Add</SubmitButton>
                  </Group>
                </ActionForm>
              )}
            </Section>

            {!configured && user.role === "admin" && (
              <Section title="Setup (admin, once)">
                <List size="sm" spacing={6} type="ordered">
                  <ListItem>In the Google Cloud project used for LimeCRM sign-in, enable the Gmail API.</ListItem>
                  <ListItem>
                    OAuth consent screen: keep User type <b>Internal</b>, and add the scope <Code>gmail.readonly</Code>.
                  </ListItem>
                  <ListItem>
                    On the OAuth client, add the redirect URI <Code>{redirectUri()}</Code>.
                  </ListItem>
                  <ListItem>
                    Make sure <Code>AUTH_GOOGLE_ID</Code>, <Code>AUTH_GOOGLE_SECRET</Code> and <Code>MAIL_TOKEN_KEY</Code> are set on the server.
                  </ListItem>
                </List>
              </Section>
            )}
          </Stack>
        </GridCol>
      </Grid>
    </>
  );
}
