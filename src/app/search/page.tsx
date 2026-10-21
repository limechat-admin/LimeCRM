import { Group, SimpleGrid, Stack, Text } from "@mantine/core";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/links";
import classes from "@/components/board.module.css";
import { Empty, LeadStatusBadge, LifecycleBadge, PageHeader, Section, StatusBadge } from "@/components/ui";
import { LEAD_STATUSES } from "@/domain/leads";
import { inr, LIFECYCLE_LABEL } from "@/lib/format";
import { getCurrentUser } from "@/server/auth";
import { searchAll } from "@/server/work";

export const metadata: Metadata = { title: "Search" };

const rowStyle = { border: 0, borderBottom: "1px solid var(--mantine-color-default-border)", borderRadius: 0 } as const;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await getCurrentUser();
  const q = ((await searchParams).q ?? "").trim();
  if (q.length < 2) {
    return (
      <>
        <PageHeader title="Search" subtitle="Find companies, deals and people." />
        <Empty>Type at least two characters in the search box above</Empty>
      </>
    );
  }
  const { orgs, deals, people } = await searchAll(q);
  const total = orgs.length + deals.length + people.length;

  return (
    <>
      <PageHeader title={`Results for “${q}”`} subtitle={total ? `${total} matches across companies, deals and people` : undefined} />
      {total === 0 ? (
        <Empty>Nothing matches “{q}”</Empty>
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="lg">
          <Section title={`Companies (${orgs.length})`}>
            {orgs.length === 0 ? (
              <Empty compact>No companies</Empty>
            ) : (
              <Stack gap={0}>
                {orgs.map((o) => (
                  <ButtonLink key={o.id} href={`/companies/${o.id}`} className={classes.card} style={rowStyle}>
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={700}>
                          {o.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {o.mrr > 0 ? `${inr(o.mrr)}/mo` : (o.website?.replace(/^https?:\/\//, "") ?? "")}
                        </Text>
                      </div>
                      <LifecycleBadge lifecycle={o.lifecycle} label={LIFECYCLE_LABEL[o.lifecycle]} />
                    </Group>
                  </ButtonLink>
                ))}
              </Stack>
            )}
          </Section>

          <Section title={`Deals (${deals.length})`}>
            {deals.length === 0 ? (
              <Empty compact>No deals</Empty>
            ) : (
              <Stack gap={0}>
                {deals.map((d) => (
                  <ButtonLink key={d.id} href={`/deals/${d.id}`} className={classes.card} style={rowStyle}>
                    <Group justify="space-between" wrap="nowrap">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={700}>
                          {d.title}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {d.orgName} · {d.stageName} · {inr(d.mrr)}/mo
                        </Text>
                      </div>
                      <StatusBadge status={d.status} />
                    </Group>
                  </ButtonLink>
                ))}
              </Stack>
            )}
          </Section>

          <Section title={`People (${people.length})`}>
            {people.length === 0 ? (
              <Empty compact>No people</Empty>
            ) : (
              <Stack gap={0}>
                {people.map((p) => {
                  const status = LEAD_STATUSES.find((s) => s.key === p.leadStatus);
                  return (
                    <ButtonLink key={p.id} href={`/leads/${p.id}`} className={classes.card} style={rowStyle}>
                      <Group justify="space-between" wrap="nowrap">
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={700}>
                            {p.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {[p.designation, p.orgName, p.email].filter(Boolean).join(" · ")}
                          </Text>
                        </div>
                        {status && <LeadStatusBadge kind={status.kind} label={status.label} />}
                      </Group>
                    </ButtonLink>
                  );
                })}
              </Stack>
            )}
          </Section>
        </SimpleGrid>
      )}
    </>
  );
}
