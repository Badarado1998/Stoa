import { createPublicClient, getAddress, http, isAddress, parseAbiItem, type Address, type Hash } from "viem";
import { API_HEADERS, apiError, limited } from "@/lib/api";
import { ROBINHOOD } from "@/lib/networks";
import { getLogsOn } from "@/lib/logs";
import { srv } from "@/lib/serverRpc";
import { routerAbi } from "@/lib/abi";
import { USDG_ADDR, hasTag, relayAmount } from "@/lib/pay";
import { RELAY_SOLVER } from "@/lib/relayOrder";
import { kv, kvOn } from "@/lib/kv";

// GET /api/pay/status?to=0x…&get=0x…&amount=<USDG units>&id=<16 hex>&b=<block>
// Whether a Stoa Pay request has been paid on Robinhood Chain. It counts only when enough arrived:
// - USDG payout: a transfer of at least `amount` USDG to the requester, in a transaction carrying the request's id
//   (every payment Stoa builds does; inside a smart wallet's wrapped call too), or, paid from another chain, Relay's
//   delivery of exactly the amount plus the request's few micro-USDG (lib/pay.ts relayAmount), bound to one request.
// - Stock payout: a tagged transfer of the stock token worth at least 97% of `amount` USDG, priced with Stoa's router
//   one block before the payment.
// `value` is what arrived, which the link page shows (never the amount written in the link).
export const dynamic = "force-dynamic";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
// about 30 days of Robinhood Chain blocks: an older request reads as not found rather than timing out
const MAX_SPAN = 20_000_000n;
// a busy address (a pool) receives many transfers: look at no more than this many
const MAX_MATCHES = 200;
const ROUTER = ROBINHOOD.contracts.router as Address;
const NO = (age = 10) => Response.json({ paid: false }, { headers: { ...API_HEADERS, "cache-control": `public, max-age=${age}` } });

export async function GET(req: Request) {
  const block = limited(req);
  if (block) return block;
  const u = new URL(req.url).searchParams;
  const to = u.get("to") ?? "", get = u.get("get") || USDG_ADDR, id = (u.get("id") ?? "").toLowerCase(), b = u.get("b") ?? "", amt = u.get("amount") ?? "";
  if (!isAddress(to, { strict: false }) || !isAddress(get, { strict: false })) return apiError(400, "to and get must be addresses");
  if (!/^[0-9a-f]{16}$/.test(id) || !/^\d{1,12}$/.test(b)) return apiError(400, "id and b are required");
  if (!/^\d{1,30}$/.test(amt) || BigInt(amt) === 0n) return apiError(400, "amount (USDG units) is required");
  const want = BigInt(amt);
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc)) });
  const head = await c.getBlockNumber().catch(() => null);
  if (head === null) return apiError(503, "busy");
  const from = BigInt(b);
  if (from > head) return NO();
  if (head - from > MAX_SPAN) return NO(60);
  let logs: Awaited<ReturnType<typeof getLogsOn<typeof TRANSFER>>>;
  try { logs = await getLogsOn(ROBINHOOD, { address: getAddress(get), event: TRANSFER, args: { to: getAddress(to) }, fromBlock: from }); }
  catch { return apiError(503, "busy"); }
  const usdg = get.toLowerCase() === USDG_ADDR.toLowerCase();
  const relayWant = relayAmount(want, id);
  // a stock payout: what `amount` USDG bought just before each payment's block, cached per block
  const stockFloor = new Map<bigint, bigint | null>();
  const floorAt = async (bn: bigint) => {
    if (!stockFloor.has(bn)) {
      const q = await c.simulateContract({ address: ROUTER, abi: routerAbi, functionName: "quote", args: [USDG_ADDR, getAddress(get), want], blockNumber: bn - 1n })
        .then((r) => (r.result as { amountOut: bigint }).amountOut).catch(() => null);
      stockFloor.set(bn, q === null ? null : (q * 97n) / 100n);
    }
    return stockFloor.get(bn)!;
  };

  let looked = 0;
  for (const l of logs) {
    const value = l.args.value ?? 0n;
    // skip what can never be enough before reading the transaction
    if (usdg && value < want) continue;
    if (++looked > MAX_MATCHES) break;
    const tx = await c.getTransaction({ hash: l.transactionHash as Hash }).catch(() => null);
    if (!tx) continue;
    let via: "stoa" | "relay" | null = null;
    if (hasTag(tx.input, id)) {
      if (usdg) via = "stoa";
      else { const floor = await floorAt(l.blockNumber!); if (floor !== null && value >= floor) via = "stoa"; }
    } else if (usdg && value === relayWant && (tx.from.toLowerCase() === RELAY_SOLVER || (l.args.from ?? "").toLowerCase() === RELAY_SOLVER)) {
      // one Relay delivery pays one request: the first request to claim it keeps it
      if (kvOn) {
        const set = await kv("SET", `pay:relay:${l.transactionHash.toLowerCase()}`, id, "NX");
        const owner = set === "OK" ? id : await kv<string>("GET", `pay:relay:${l.transactionHash.toLowerCase()}`);
        if (owner === id) via = "relay";
      } else via = "relay";
    }
    if (!via) continue;
    const blk = await c.getBlock({ blockNumber: l.blockNumber! }).catch(() => null);
    return Response.json({ paid: true, via, tx: l.transactionHash, from: tx.from, value: value.toString(), at: blk ? Number(blk.timestamp) : null }, { headers: { ...API_HEADERS, "cache-control": "public, max-age=15" } });
  }
  return NO();
}
