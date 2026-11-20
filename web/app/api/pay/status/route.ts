import { createPublicClient, getAddress, http, isAddress, parseAbiItem, type Hash } from "viem";
import { API_HEADERS, apiError, limited } from "@/lib/api";
import { ROBINHOOD } from "@/lib/networks";
import { getLogsOn } from "@/lib/logs";
import { srv } from "@/lib/serverRpc";
import { USDG_ADDR, tagIn } from "@/lib/pay";
import { RELAY_SOLVER } from "@/lib/relayOrder";

// GET /api/pay/status?to=0x…&get=0x…&amount=<USDG units>&id=<16 hex>&b=<block>
// Whether a Stoa Pay request has been paid on Robinhood Chain: a transfer of the payout token to the requester, from
// the request's block on, in a transaction that carries the request's id (every payment Stoa builds does), or, for a
// USDG payout paid from another chain, a transfer of exactly the amount by Relay's solver.
export const dynamic = "force-dynamic";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
// the furthest back a request is looked at: about 30 days of Robinhood Chain blocks is far more than any RPC answers
// quickly, so a request older than this reads as not found rather than timing out
const MAX_SPAN = 20_000_000n;

export async function GET(req: Request) {
  const block = limited(req);
  if (block) return block;
  const u = new URL(req.url).searchParams;
  const to = u.get("to") ?? "", get = u.get("get") || USDG_ADDR, id = (u.get("id") ?? "").toLowerCase(), b = u.get("b") ?? "", amt = u.get("amount") ?? "";
  if (!isAddress(to, { strict: false }) || !isAddress(get, { strict: false })) return apiError(400, "to and get must be addresses");
  if (!/^[0-9a-f]{16}$/.test(id) || !/^\d{1,12}$/.test(b)) return apiError(400, "id and b are required");
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc)) });
  const head = await c.getBlockNumber().catch(() => null);
  if (head === null) return apiError(503, "busy");
  let from = BigInt(b);
  if (from > head) return Response.json({ paid: false }, { headers: { ...API_HEADERS, "cache-control": "no-store" } });
  if (head - from > MAX_SPAN) from = head - MAX_SPAN;
  let logs: Awaited<ReturnType<typeof getLogsOn<typeof TRANSFER>>>;
  try { logs = await getLogsOn(ROBINHOOD, { address: getAddress(get), event: TRANSFER, args: { to: getAddress(to) }, fromBlock: from }); }
  catch { return apiError(503, "busy"); }
  const usdg = get.toLowerCase() === USDG_ADDR.toLowerCase();
  const want = /^\d{1,30}$/.test(amt) ? BigInt(amt) : null;
  for (const l of logs) {
    const tx = await c.getTransaction({ hash: l.transactionHash as Hash }).catch(() => null);
    if (!tx) continue;
    const via = tagIn(tx.input) === id ? "stoa" : usdg && want !== null && l.args.value === want && (tx.from.toLowerCase() === RELAY_SOLVER || (l.args.from ?? "").toLowerCase() === RELAY_SOLVER) ? "relay" : null;
    if (!via) continue;
    const blk = await c.getBlock({ blockNumber: l.blockNumber! }).catch(() => null);
    return Response.json({ paid: true, via, tx: l.transactionHash, from: tx.from, value: l.args.value!.toString(), at: blk ? Number(blk.timestamp) : null }, { headers: { ...API_HEADERS, "cache-control": "public, max-age=15" } });
  }
  return Response.json({ paid: false }, { headers: { ...API_HEADERS, "cache-control": "public, max-age=10" } });
}
