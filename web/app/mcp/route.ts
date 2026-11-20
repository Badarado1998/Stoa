import { API_HEADERS, limited } from "@/lib/api";
import { TOOLS, callTool } from "@/lib/mcpTools";

// https://stoadex.com/mcp: Stoa as a hosted, keyless MCP server (Streamable HTTP, stateless, JSON responses).
// Read-only: every tool reads the chain or Stoa's own data. build_swap returns an UNSIGNED transaction; nothing here
// can sign, hold keys or move funds. Same limits as the public API (60 requests a minute per IP). Docs: /docs/mcp

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROTOCOL = "2025-06-18";
const SERVER = { name: "stoa", title: "Stoa: every route, compared", version: "1.0.0" };
const INSTRUCTIONS = [
  "Stoa is a swap router on Robinhood Chain (chain id 4663, gas ETH) and Elysium (gas HYPE).",
  "Rules for agents: 1) Get token addresses from list_tokens or from the project's own site, never from a reply or DM.",
  "2) Run safety_check before buying any token that is not in list_tokens' verified set; a 'danger' verdict means do not buy.",
  "3) Quote, show the user amountOut, minOut, price impact and route, and only then call build_swap.",
  "4) build_swap returns an unsigned transaction: the user's own wallet signs it. If selling a token (not native), the wallet must first approve approval.spender for approval.amount.",
  "5) Quotes move: rebuild right before sending. Amounts are integers in the token's smallest unit (wei).",
  "6) No funds on Robinhood Chain yet? bridge_quote moves ETH, USDC or USDT from Base, Arbitrum, Ethereum, Optimism or BNB Chain; Stoa decodes and checks the transaction before returning it, and the user's wallet signs it on the source chain.",
  "7) market_context gives CoinMarketCap's view (crypto market, Fear and Greed, a token's market cap, liquidity and 24h trading) to put a trade in context; it is not advice, and the price a swap gets is the one quote returns.",
].join(" ");

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(m: Rpc) {
  switch (m.method) {
    case "initialize":
      return ok(m.id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS });
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS });
    case "tools/call": {
      const p = m.params ?? {};
      const out = await callTool(String(p.name ?? ""), (p.arguments as Record<string, unknown>) ?? {});
      return out ? ok(m.id, out) : err(m.id, -32602, `unknown tool: ${String(p.name)}`);
    }
    case "resources/list": return ok(m.id, { resources: [] });
    case "prompts/list": return ok(m.id, { prompts: [] });
    default:
      return err(m.id, -32601, `method not found: ${m.method}`);
  }
}

const H = { ...API_HEADERS, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept", "access-control-expose-headers": "mcp-session-id" };

export async function POST(req: Request) {
  const block = limited(req);
  if (block) return block;
  let msg: unknown;
  try { msg = await req.json(); } catch { return Response.json(err(null, -32700, "parse error"), { status: 400, headers: H }); }
  const batch = Array.isArray(msg) ? (msg as Rpc[]) : [msg as Rpc];
  const out = [];
  for (const m of batch) {
    if (!m || typeof m !== "object" || typeof m.method !== "string") { out.push(err(null, -32600, "invalid request")); continue; }
    if (m.id === undefined) continue; // notification (e.g. notifications/initialized): no reply
    out.push(await handle(m));
  }
  if (!out.length) return new Response(null, { status: 202, headers: H });
  return Response.json(Array.isArray(msg) ? out : out[0], { headers: H });
}

// Stateless server: no server-initiated stream and no sessions to end.
export function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) return new Response(null, { status: 405, headers: { ...H, allow: "POST, OPTIONS" } });
  return Response.json({ ...SERVER, transport: "streamable-http", endpoint: "https://stoadex.com/mcp", tools: TOOLS.map((t) => t.name), docs: "https://stoadex.com/docs/mcp", note: "POST JSON-RPC here from an MCP client." }, { headers: H });
}
export function DELETE() { return new Response(null, { status: 405, headers: H }); }
export function OPTIONS() { return new Response(null, { status: 204, headers: H }); }
