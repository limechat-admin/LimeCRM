import { getCurrentUser } from "@/server/auth";
import { getFunnel, isReportKey, REPORTS } from "@/server/reports";
import { toCsv } from "../../aggregate";
import { parseFunnelOptions } from "../../funnel";
import { parseRange, todayIst } from "../../range";

/** GET /reports/csv/:report?range=… — the rows behind a report card, as CSV (Excel-friendly UTF-8). */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  await getCurrentUser();
  const { report } = await params;
  if (!isReportKey(report)) return new Response("Unknown report", { status: 404 });
  const def = REPORTS[report];
  const query = new URL(req.url).searchParams;
  const range = parseRange(query.get("range"), todayIst(), def.fallback);
  const { csv } = report === "funnel" ? await getFunnel(range, parseFunnelOptions((k) => query.get(k))) : await def.load(range);
  const filename = `limecrm-${report}-${range.from}-to-${range.to}.csv`;
  return new Response(`﻿${toCsv(csv.header, csv.rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
