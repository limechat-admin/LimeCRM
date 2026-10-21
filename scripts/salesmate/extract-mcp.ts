/**
 * Interim extract through the Salesmate MCP connector (search_deals only), for dev/staging loads
 * until the rotated API token is available for the full `migrate:extract`.
 *
 *   pnpm migrate:extract-mcp [--server ~/Documents/salesmate-mcp/stdio.js]
 *
 * Launches the same stdio MCP server the Claude app uses (it carries its own credentials) and pages
 * through search_deals per pipeline, then once unfiltered to catch other pipelines. Pages are written
 * in the snapshot layout `migrate:transform` reads: data/salesmate/<ts>-mcp/deals/pages/*.json.
 *
 * What this source can't give (so the transform sees them as missing): custom fields (rate card,
 * LC Account ID, contract dates), companies, contact details, activities, user emails, created and
 * closed dates. Search results only include Open deals; the status filter is broken upstream.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DATA_ROOT, parseArgs, writeJson } from "./lib/util";

const PIPELINES = ["Sales Pipeline", "Onboarding Pipeline", "Customer Success Pipeline", "Reconnect Pipeline"] as const;
const PAGE = 200;

type Row = Record<string, unknown> & { id: number };

async function main() {
  const args = parseArgs();
  const server = resolve((args.server ?? "~/Documents/salesmate-mcp/stdio.js").replace(/^~/, homedir()));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(DATA_ROOT, `${stamp}-mcp`);

  const client = new Client({ name: "limecrm-extract", version: "1.0.0" });
  // Inherit the environment so SALESMATE_SESSION_KEY reaches the server if it's set.
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: process.env as Record<string, string> }));

  async function page(input: Record<string, unknown>): Promise<Row[]> {
    for (let attempt = 1; ; attempt++) {
      const res = await client.callTool({ name: "search_deals", arguments: input });
      const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
      if (!res.isError) return (JSON.parse(text) as { records: Row[] }).records ?? [];
      if (attempt >= 4) throw new Error(`search_deals ${JSON.stringify(input)} failed: ${text.slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  const seen = new Map<number, Row>();
  const perPipeline: Record<string, number> = {};
  let fileNo = 0;
  async function sweep(label: string, filter: Record<string, unknown>) {
    let added = 0;
    for (let offset = 0; ; offset += PAGE) {
      const rows = await page({ ...filter, limit: PAGE, offset });
      const fresh = rows.filter((r) => !seen.has(r.id));
      fresh.forEach((r) => seen.set(r.id, r));
      added += fresh.length;
      if (fresh.length) writeJson(join(dir, "deals", "pages", `${String(fileNo++).padStart(4, "0")}.json`), { data: fresh });
      process.stdout.write(`\r${label}: ${offset + rows.length} rows read, ${added} new   `);
      if (rows.length < PAGE) break;
    }
    process.stdout.write("\n");
    perPipeline[label] = added;
  }

  for (const p of PIPELINES) await sweep(p, { pipeline: p });
  await sweep("other pipelines (unfiltered pass)", {});
  await client.close();

  writeJson(
    join(dir, "manifest.json"),
    {
      source: "salesmate-mcp search_deals",
      startedAt: new Date().toISOString(),
      counts: { deals: seen.size, perPipeline },
      limitations: [
        "no custom fields (rate card, LC Account ID, contract dates, segment)",
        "no companies, contact details, activities or user emails",
        "no created/closed dates; only Open deals (status filter broken upstream)",
      ],
    },
    true,
  );
  console.log(`\n${seen.size} deals → ${dir}`);
  console.table(perPipeline);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
