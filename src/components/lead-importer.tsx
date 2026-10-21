"use client";
/** Lead CSV import: pick a file → check the column mapping → preview with per-row problems → import. */
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  Group,
  List,
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
  Title,
} from "@mantine/core";
import { FileSpreadsheet, Upload } from "lucide-react";
import Papa from "papaparse";
import { useMemo, useState, useTransition } from "react";
import { importLeadsAction, type ImportResult } from "@/app/actions";
import {
  duplicateEmailsInFile,
  guessColumns,
  LEAD_IMPORT_FIELDS,
  mapLeadRow,
  MAX_IMPORT_ROWS,
  type ColumnMap,
  type LeadImportField,
} from "@/domain/csv";
import { AnchorLink } from "./links";

type Parsed = { fileName: string; headers: string[]; records: Record<string, unknown>[] };

const REQUIRED: LeadImportField[] = ["name", "companyName"];

export function LeadImporter() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [defaultSource, setDefaultSource] = useState("Sheet Allocation (Outbound)");
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | null) {
    setResult(null);
    setParseError(null);
    setParsed(null);
    if (!file) return;
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!headers.length) return setParseError("That file has no header row.");
        if (res.data.length > MAX_IMPORT_ROWS) return setParseError(`That file has ${res.data.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`);
        setParsed({ fileName: file.name, headers, records: res.data });
        setMap(guessColumns(headers));
      },
      error: (err) => setParseError(err.message),
    });
  }

  const mapped = useMemo(() => {
    if (!parsed) return [];
    const rows = parsed.records.map((rec, i) => mapLeadRow(rec, map, i + 1, defaultSource.trim() || null));
    const dupes = duplicateEmailsInFile(rows);
    return rows.map((r) => (dupes.has(r.row) ? { ...r, data: null, errors: [...r.errors, "Same email as an earlier row"] } : r));
  }, [parsed, map, defaultSource]);

  /** What the file said, for rows that failed validation (their mapped data is null). */
  const raw = (row: number, f: LeadImportField) => {
    const col = map[f];
    const v = col ? parsed?.records[row - 1]?.[col] : undefined;
    return typeof v === "string" && v.trim() ? v.trim() : "—";
  };

  const valid = mapped.filter((r) => r.data);
  const invalid = mapped.filter((r) => !r.data);
  const missingRequired = REQUIRED.filter((f) => !map[f]);

  function runImport() {
    startTransition(async () => {
      setResult(await importLeadsAction(valid.map((r) => ({ row: r.row, data: r.data! }))));
    });
  }

  return (
    <Stack gap="lg">
      <Card withBorder>
        <Stack gap="sm">
          <Title order={5}>1. Choose a CSV file</Title>
          <Text size="sm" c="dimmed">
            One row per person, with a header row. Name and Company are required; Email, Phone, Designation, Website, Source, LinkedIn, SDR email and AE
            email are optional. Up to {MAX_IMPORT_ROWS} rows per file.
          </Text>
          <FileInput
            accept=".csv,text/csv"
            placeholder="Pick a .csv file"
            leftSection={<FileSpreadsheet size={16} />}
            onChange={onFile}
            clearable
            maw={420}
            aria-label="CSV file"
          />
          {parseError && (
            <Alert color="red" variant="light">
              {parseError}
            </Alert>
          )}
        </Stack>
      </Card>

      {parsed && (
        <Card withBorder>
          <Stack gap="sm">
            <Title order={5}>2. Match the columns</Title>
            <Text size="sm" c="dimmed">
              Matched automatically from {parsed.fileName}&apos;s headers. Fix anything that&apos;s wrong.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
              {(Object.keys(LEAD_IMPORT_FIELDS) as LeadImportField[]).map((f) => (
                <Select
                  key={f}
                  label={LEAD_IMPORT_FIELDS[f]}
                  withAsterisk={REQUIRED.includes(f)}
                  placeholder="Not in this file"
                  clearable
                  data={parsed.headers}
                  value={map[f] ?? null}
                  onChange={(v) => setMap((m) => ({ ...m, [f]: v ?? undefined }))}
                />
              ))}
              <TextInput
                label="Source when the file has none"
                value={defaultSource}
                onChange={(e) => setDefaultSource(e.currentTarget.value)}
              />
            </SimpleGrid>
            {missingRequired.length > 0 && (
              <Alert color="yellow" variant="light">
                Match {missingRequired.map((f) => LEAD_IMPORT_FIELDS[f]).join(" and ")} to continue.
              </Alert>
            )}
          </Stack>
        </Card>
      )}

      {parsed && missingRequired.length === 0 && (
        <Card withBorder>
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={5}>3. Check and import</Title>
              <Group gap="xs">
                <Badge color="green">{valid.length} ready</Badge>
                {invalid.length > 0 && <Badge color="red">{invalid.length} with problems</Badge>}
              </Group>
            </Group>
            <Text size="sm" c="dimmed">
              People already in LimeCRM (same email) are skipped, not overwritten. Companies are matched by name or created as prospects.
            </Text>
            <TableScrollContainer minWidth={720}>
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh w={50}>Row</TableTh>
                    <TableTh>Name</TableTh>
                    <TableTh>Company</TableTh>
                    <TableTh>Email</TableTh>
                    <TableTh>Source</TableTh>
                    <TableTh>Problems</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {[...invalid, ...valid].slice(0, 25).map((r) => (
                    <TableTr key={r.row}>
                      <TableTd c="dimmed">{r.row}</TableTd>
                      <TableTd>{r.data?.name ?? raw(r.row, "name")}</TableTd>
                      <TableTd>{r.data?.companyName ?? raw(r.row, "companyName")}</TableTd>
                      <TableTd>{r.data?.email ?? raw(r.row, "email")}</TableTd>
                      <TableTd>{r.data?.source ?? raw(r.row, "source")}</TableTd>
                      <TableTd>{r.errors.length ? <Text size="sm" c="red">{r.errors.join("; ")}</Text> : <Badge color="green">OK</Badge>}</TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </TableScrollContainer>
            {mapped.length > 25 && (
              <Text size="xs" c="dimmed">
                Showing 25 of {mapped.length} rows (problem rows first).
              </Text>
            )}
            <Group>
              <Button leftSection={<Upload size={16} />} onClick={runImport} loading={pending} disabled={valid.length === 0 || !!result?.ok}>
                Import {valid.length} lead{valid.length === 1 ? "" : "s"}
              </Button>
              {invalid.length > 0 && (
                <Text size="xs" c="dimmed">
                  Rows with problems are left out.
                </Text>
              )}
            </Group>
          </Stack>
        </Card>
      )}

      {result && !result.ok && (
        <Alert color="red" variant="light" title="Import failed">
          {result.message}
        </Alert>
      )}
      {result?.ok && (
        <Alert color="green" variant="light" title={`Imported ${result.summary.created} lead${result.summary.created === 1 ? "" : "s"}`}>
          <Stack gap={6}>
            {result.summary.duplicates.length > 0 && (
              <Text size="sm">
                Skipped {result.summary.duplicates.length} already in LimeCRM: {result.summary.duplicates.slice(0, 5).map((d) => d.email).join(", ")}
                {result.summary.duplicates.length > 5 ? "…" : ""}
              </Text>
            )}
            {result.summary.failed.length > 0 && (
              <List size="sm">
                {result.summary.failed.slice(0, 10).map((f) => (
                  <List.Item key={f.row}>
                    Row {f.row}: {f.message}
                  </List.Item>
                ))}
              </List>
            )}
            <AnchorLink href="/leads?status=not_contacted" size="sm">
              See new leads
            </AnchorLink>
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
