import {
  ActionIcon,
  Badge,
  Group,
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
import { asc } from "drizzle-orm";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { AnchorLink } from "@/components/links";
import { Empty, PageHeader, Section } from "@/components/ui";
import { db } from "@/db";
import { stages } from "@/db/schema";
import { PICKLISTS } from "@/domain/fields";
import { GATE_FIELDS, isGateFieldKey } from "@/domain/gates";
import { getCurrentUser } from "@/server/auth";
import { getFieldOptions, offListValues, optionUsage } from "@/server/fields";
import { addOptionAction, moveOptionAction, restoreOptionAction } from "./actions";
import { MapValue, RenameOption, RetireOption } from "./option-forms";

export const metadata: Metadata = { title: "Fields" };

export default async function FieldsPage() {
  const user = await getCurrentUser();
  if (user.role !== "admin") notFound();
  const [options, usage, offList, stageRows] = await Promise.all([
    getFieldOptions(),
    Promise.all(PICKLISTS.map((p) => optionUsage(p.key))),
    Promise.all(PICKLISTS.map((p) => offListValues(p.key))),
    db.select().from(stages).orderBy(asc(stages.pipeline), asc(stages.position)),
  ]);

  return (
    <>
      <PageHeader
        title="Fields"
        subtitle="The allowed values for every dropdown on leads, deals and companies. Forms, bulk edit, imports and the API only accept these, so reports group cleanly."
      />
      <Stack gap="lg">
        {PICKLISTS.map((p, i) => {
          const active = options[p.key].filter((o) => !o.retired);
          const retired = options[p.key].filter((o) => o.retired);
          const used = (v: string) => usage[i].get(v) ?? 0;
          const off = offList[i];
          return (
            <Section
              key={p.key}
              title={p.label}
              actions={
                <Text size="xs" c="dimmed" ta="right">
                  {p.help}. Used on {p.columns.map((c) => c.label.toLowerCase()).join(", ")}
                  {p.multi ? " (several per record)" : ""}.
                </Text>
              }
            >
              <SimpleGrid cols={{ base: 1, xl: off.length ? 2 : 1 }} spacing="lg">
                <Stack gap="sm">
                  <TableScrollContainer minWidth={420}>
                    <Table>
                      <TableThead>
                        <TableTr>
                          <TableTh>Value</TableTh>
                          <TableTh ta="right">Records</TableTh>
                          <TableTh />
                        </TableTr>
                      </TableThead>
                      <TableTbody>
                        {active.map((o, j) => (
                          <TableTr key={o.value}>
                            <TableTd>
                              <Text size="sm" fw={600}>
                                {o.value}
                              </Text>
                            </TableTd>
                            <TableTd ta="right">{used(o.value).toLocaleString("en-IN")}</TableTd>
                            <TableTd>
                              <Group gap={2} justify="flex-end" wrap="nowrap">
                                <InlineAction action={moveOptionAction} hidden={{ field: p.key, value: o.value, dir: "up" }}>
                                  <ActionIcon type="submit" size="sm" variant="subtle" color="gray" disabled={j === 0} aria-label={`Move ${o.value} up`}>
                                    <ArrowUp size={14} />
                                  </ActionIcon>
                                </InlineAction>
                                <InlineAction action={moveOptionAction} hidden={{ field: p.key, value: o.value, dir: "down" }}>
                                  <ActionIcon
                                    type="submit"
                                    size="sm"
                                    variant="subtle"
                                    color="gray"
                                    disabled={j === active.length - 1}
                                    aria-label={`Move ${o.value} down`}
                                  >
                                    <ArrowDown size={14} />
                                  </ActionIcon>
                                </InlineAction>
                                <RenameOption field={p.key} value={o.value} />
                                <RetireOption
                                  field={p.key}
                                  value={o.value}
                                  used={used(o.value)}
                                  others={active.filter((x) => x.value !== o.value).map((x) => x.value)}
                                />
                              </Group>
                            </TableTd>
                          </TableTr>
                        ))}
                      </TableTbody>
                    </Table>
                  </TableScrollContainer>
                  <ActionForm action={addOptionAction}>
                    <input type="hidden" name="field" value={p.key} />
                    <Group gap="xs" align="flex-end">
                      <TextInput
                        name="value"
                        placeholder={`New ${p.label.toLowerCase()} value`}
                        aria-label={`New ${p.label} value`}
                        style={{ flex: 1 }}
                        required
                      />
                      <SubmitButton variant="default">Add</SubmitButton>
                    </Group>
                  </ActionForm>
                  {retired.length > 0 && (
                    <Group gap={6}>
                      <Text size="xs" c="dimmed">
                        Retired:
                      </Text>
                      {retired.map((o) => (
                        <InlineAction key={o.value} action={restoreOptionAction} hidden={{ field: p.key, value: o.value }}>
                          <Badge color="gray" component="button" type="submit" style={{ cursor: "pointer" }} title="Offer it again">
                            {o.value} · {used(o.value)}
                          </Badge>
                        </InlineAction>
                      ))}
                    </Group>
                  )}
                </Stack>

                {off.length > 0 && (
                  <Stack gap={6}>
                    <Text size="sm" fw={700}>
                      Not on the list ({off.reduce((a, v) => a + v.count, 0).toLocaleString("en-IN")} records)
                    </Text>
                    <Text size="xs" c="dimmed">
                      Values typed or imported before this list existed. Change each to a listed value; a suggestion is filled in where one matches.
                    </Text>
                    <TableScrollContainer minWidth={420}>
                      <Table>
                        <TableTbody>
                          {off.slice(0, 25).map((v) => (
                            <TableTr key={v.value}>
                              <TableTd>
                                <Text size="sm">{v.value}</Text>
                                <Text size="xs" c="dimmed">
                                  {v.count} {v.count === 1 ? "record" : "records"}
                                </Text>
                              </TableTd>
                              <TableTd>
                                <MapValue field={p.key} value={v.value} options={active.map((o) => o.value)} suggestion={v.suggestion} />
                              </TableTd>
                            </TableTr>
                          ))}
                        </TableTbody>
                      </Table>
                    </TableScrollContainer>
                    {off.length > 25 && (
                      <Text size="xs" c="dimmed">
                        And {off.length - 25} more values. Fix the biggest first.
                      </Text>
                    )}
                  </Stack>
                )}
              </SimpleGrid>
            </Section>
          );
        })}

        <Section title="Required fields by stage">
          <Text size="sm" c="dimmed" mb="sm">
            A record can&apos;t enter a stage until these are filled; requirements carry forward to later stages. The CRM hygiene report scores against the same
            list. Data quality issues: see <AnchorLink href="/settings/data-quality">Data quality</AnchorLink>.
          </Text>
          {stageRows.length === 0 ? (
            <Empty compact>No stages</Empty>
          ) : (
            <TableScrollContainer minWidth={560}>
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Pipeline</TableTh>
                    <TableTh>Stage</TableTh>
                    <TableTh>Adds these required fields</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {stageRows
                    .filter((s) => s.requiredFields.length)
                    .map((s) => (
                      <TableTr key={s.id}>
                        <TableTd tt="capitalize">{s.pipeline}</TableTd>
                        <TableTd>{s.name}</TableTd>
                        <TableTd>
                          <Group gap={4}>
                            {s.requiredFields.filter(isGateFieldKey).map((k) => (
                              <Badge key={k} color="gray">
                                {GATE_FIELDS[k].label}
                              </Badge>
                            ))}
                          </Group>
                        </TableTd>
                      </TableTr>
                    ))}
                </TableTbody>
              </Table>
            </TableScrollContainer>
          )}
        </Section>
      </Stack>
    </>
  );
}
