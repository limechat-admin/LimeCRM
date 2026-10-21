import { apiJson, authorize, searchOrganizations } from "@/server/api";

/** GET /api/v1/organizations?lifecycle=active&q=acme — the customer book with contracted MRR and owners. */
export async function GET(req: Request) {
  const caller = await authorize(req, "search_organizations");
  if (caller instanceof Response) return caller;
  const params = new URL(req.url).searchParams;
  return apiJson(await searchOrganizations({ lifecycle: params.get("lifecycle") || undefined, q: params.get("q") || undefined }));
}
