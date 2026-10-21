import {
  Badge,
  Button,
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
import { notFound } from "next/navigation";
import { InlineAction, SubmitButton } from "@/components/forms";
import { Empty, PageHeader, Section } from "@/components/ui";
import { ALL_EVENTS } from "@/domain/webhook-events";
import { dateTime } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { listWebhookEndpoints, recentDeliveries } from "@/server/webhooks";
import { pingEndpointAction, toggleEndpointAction } from "./actions";
import { CreateEndpointForm, DeleteEndpointButton } from "./webhook-forms";

export const metadata: Metadata = { title: "Webhooks" };

const STATUS_COLOR: Record<string, string> = { sent: "green", pending: "yellow", sending: "yellow", failed: "red", skipped: "gray" };
const STATUS_LABEL: Record<string, string> = { sent: "Delivered", pending: "Retrying", sending: "Sending", failed: "Failed", skipped: "Skipped" };

export default async function WebhooksPage() {
  const user = await getCurrentUser();
  if (user.role !== "admin") notFound();
  const [endpoints, deliveries] = await Promise.all([listWebhookEndpoints(), recentDeliveries(50)]);

  return (
    <>
      <PageHeader title="Webhooks" subtitle="Tell internal apps the moment a deal, company, onboarding or lead changes, instead of having them poll the API." />
      <Grid gap="lg" mb="lg">
        <GridCol span={{ base: 12, md: 7 }}>
          <Section title="New webhook">
            <CreateEndpointForm />
          </Section>
        </GridCol>
        <GridCol span={{ base: 12, md: 5 }}>
          <Section title="What the app receives">
            <List size="sm" spacing={6}>
              <ListItem>
                A <Code>POST</Code> with <Code>{"{ id, event, occurredAt, data: { entityType, id, orgId, changes }, links }"}</Code>. Fetch the full
                record from <Code>links.api</Code> with an API key.
              </ListItem>
              <ListItem>
                <Code>X-LimeCRM-Signature: t=…,v1=…</Code>: HMAC-SHA256 of <Code>{"<t>.<body>"}</Code> with the secret. Reject anything older than
                5 minutes.
              </ListItem>
              <ListItem>Answer 2xx within 10 seconds. Failures retry for about 5 hours; a 4xx (other than 408/429) stops retries.</ListItem>
              <ListItem>
                The same delivery can arrive twice, so de-duplicate on <Code>id</Code>.
              </ListItem>
            </List>
          </Section>
        </GridCol>
      </Grid>

      <Section title={`Endpoints (${endpoints.length})`}>
        {endpoints.length === 0 ? (
          <Empty>No webhooks yet</Empty>
        ) : (
          <TableScrollContainer minWidth={820}>
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>Name</TableTh>
                  <TableTh>Events</TableTh>
                  <TableTh>Last delivery</TableTh>
                  <TableTh />
                </TableTr>
              </TableThead>
              <TableTbody>
                {endpoints.map((ep) => (
                  <TableTr key={ep.id} opacity={ep.isActive ? 1 : 0.6}>
                    <TableTd maw={320}>
                      <Group gap={6}>
                        <Text size="sm" fw={600}>
                          {ep.name}
                        </Text>
                        {!ep.isActive && <Badge color="gray">Paused</Badge>}
                      </Group>
                      <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
                        {ep.url}
                      </Text>
                      <Text size="xs" c="dimmed">
                        Secret <Code>{ep.secretHint}</Code>
                      </Text>
                    </TableTd>
                    <TableTd>
                      {ep.events.includes(ALL_EVENTS) ? (
                        <Badge color="lime">All events</Badge>
                      ) : (
                        <Group gap={4}>
                          {ep.events.map((e) => (
                            <Badge key={e} color="gray">
                              {e}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </TableTd>
                    <TableTd>
                      {ep.last ? (
                        <>
                          <Badge color={STATUS_COLOR[ep.last.status]}>{STATUS_LABEL[ep.last.status]}</Badge>
                          <Text size="xs" c="dimmed">
                            {dateTime(ep.last.at)}
                            {ep.last.responseStatus ? ` · HTTP ${ep.last.responseStatus}` : ""}
                          </Text>
                        </>
                      ) : (
                        <Text size="sm" c="dimmed">
                          None yet
                        </Text>
                      )}
                    </TableTd>
                    <TableTd ta="right">
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <InlineAction action={pingEndpointAction} hidden={{ endpointId: ep.id }}>
                          <SubmitButton size="xs" variant="default" disabled={!ep.isActive}>
                            Send test
                          </SubmitButton>
                        </InlineAction>
                        <InlineAction action={toggleEndpointAction} hidden={{ endpointId: ep.id, active: String(!ep.isActive) }}>
                          <Button type="submit" size="xs" variant="subtle">
                            {ep.isActive ? "Pause" : "Resume"}
                          </Button>
                        </InlineAction>
                        <DeleteEndpointButton endpointId={ep.id} name={ep.name} />
                      </Group>
                    </TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </TableScrollContainer>
        )}
      </Section>

      <Card withBorder p={0} mt="lg">
        <Text fw={700} p="md" pb={0}>
          Recent deliveries
        </Text>
        {deliveries.length === 0 ? (
          <Empty compact>Nothing sent yet</Empty>
        ) : (
          <TableScrollContainer minWidth={760}>
            <Table>
              <TableThead>
                <TableTr>
                  <TableTh>When</TableTh>
                  <TableTh>Webhook</TableTh>
                  <TableTh>Event</TableTh>
                  <TableTh>Status</TableTh>
                  <TableTh>Detail</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {deliveries.map(({ d, endpoint }) => (
                  <TableTr key={d.id}>
                    <TableTd>
                      <Text size="sm">{dateTime(d.createdAt)}</Text>
                    </TableTd>
                    <TableTd>
                      <Text size="sm">{endpoint}</Text>
                    </TableTd>
                    <TableTd>
                      <Code>{d.event}</Code>
                    </TableTd>
                    <TableTd>
                      <Badge color={STATUS_COLOR[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                    </TableTd>
                    <TableTd>
                      <Text size="xs" c="dimmed">
                        {[d.responseStatus && `HTTP ${d.responseStatus}`, d.lastError, d.attempts > 1 && `${d.attempts} attempts`].filter(Boolean).join(" · ") || "—"}
                      </Text>
                    </TableTd>
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
