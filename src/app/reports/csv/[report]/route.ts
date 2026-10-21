import { getCurrentUser } from "@/server/auth";
import { isReportKey, REPORTS } from "@/server/reports";
import { toCsv } from "../../aggregate";
import { parseRange, todayIst } from "../../range";

/** GET /reports/csv/:report?range=… — the rows behind a report card, as CSV (Excel-friendly UTF-8). */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  await getCurrentUser();
  const { report } = await params;
  if (!isReportKey(report)) return new Response("Unknown report", { status: 404 });
  const def = REPORTS[report];
  const range = parseRange(new URL(req.url).searchParams.get("range"), todayIst(), def.fallback);
  const { csv } = await def.load(range);
  const filename = `limecrm-${report}-${range.from}-to-${range.to}.csv`;
  return new Response(`﻿${toCsv(csv.header, csv.rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
