import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";
import { authenticate } from "@/server/api";
import { buildMcpServer } from "./tools";

/**
 * MCP server (Streamable HTTP), authenticated with a LimeCRM API key:
 * `Authorization: Bearer lcrm_…`. Stateless: every POST gets its own server bound to the key, so
 * there are no sessions to keep and it runs on any number of instances. The shared
 * LIMECRM_API_TOKEN isn't accepted here, because MCP writes have to act as a real user.
 */
export async function POST(req: Request) {
  const auth = await authenticate(req, { allowSharedToken: false });
  if (!auth.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", error: { code: -32001, message: auth.error }, id: null },
      { status: auth.status, headers: { "WWW-Authenticate": 'Bearer realm="limecrm"' } },
    );
  }
  const server = buildMcpServer(auth.data);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

// No server-initiated stream and no sessions to end in stateless mode.
const methodNotAllowed = () =>
  NextResponse.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { status: 405, headers: { Allow: "POST" } });

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
