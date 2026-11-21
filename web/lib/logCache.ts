import "server-only";
import { createPublicClient, http, type AbiEvent, type Address } from "viem";
import type { Net } from "./networks";
import { srv } from "./serverRpc";
import { kv, kvOn } from "./kv";

// Server-side event logs that are read once and then only from the last block seen. Every Vercel function shares a few
// egress IPs, so reading a contract's whole history from the public RPC on each render hits its rate limit (HTTP 429)
// under load. Here the decoded logs are kept in KV with the last block read; each call asks only for the new blocks,
// first from the public logs RPC (no block cap), then from the read RPCs (their free plans cap a log query, so only a
// short catch-up is tried there). A warm instance also keeps the result in memory for MEM_MS (a minute).

const MEM_MS = 60_000;
const RESAVE_BLOCKS = 50_000n; // with no new logs, the stored head is moved on only every ~50k blocks (fewer KV writes)
const MAX_FALLBACK_SPAN = 9_000n; // dRPC's free plan caps a log query at 10k blocks
const mem = new Map<string, { at: number; v: Stored }>();

type Row = { b: string; args: unknown }; // block number, decoded args (bigints as {$b: "…"})
type Stored = { to: string; rows: Row[] };

const enc = (v: unknown): unknown =>
  typeof v === "bigint" ? { $b: v.toString() } : Array.isArray(v) ? v.map(enc) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v;
const dec = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(dec) : v && typeof v === "object" ? ("$b" in v ? BigInt((v as { $b: string }).$b) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]))) : v;

async function fetchRange(net: Net, q: { address: Address; event: AbiEvent; args?: Record<string, unknown> }, from: bigint): Promise<{ to: bigint; rows: Row[] }> {
  const urls = [net.logsRpc, ...(net.chain.rpcUrls.default.http as readonly string[])].filter((u, i, a) => u && a.indexOf(u) === i);
  let last: unknown;
  for (const [i, url] of urls.entries()) {
    try {
      const c = createPublicClient({ chain: net.chain, transport: http(srv(url), { timeout: 12_000, retryCount: 1, fetchOptions: { headers: { "user-agent": "curl/8.5.0" } } }) });
      const head = await c.getBlockNumber();
      if (head < from) return { to: from - 1n, rows: [] };
      // the public logs RPC takes the whole range in windows of logsSpan; the read RPCs only a short catch-up
      const span = i === 0 ? (net.logsSpan === 0n ? head - from + 1n : net.logsSpan) : MAX_FALLBACK_SPAN;
      if (i > 0 && head - from + 1n > span * 3n) throw new Error("range too long for a capped RPC");
      const rows: Row[] = [];
      for (let a = from; a <= head; a += span) {
        const z = a + span - 1n < head ? a + span - 1n : head;
        const logs = (await c.getLogs({ ...q, fromBlock: a, toBlock: z } as never)) as unknown as { blockNumber: bigint; args: unknown }[];
        for (const l of logs) rows.push({ b: l.blockNumber.toString(), args: enc(l.args) });
      }
      return { to: head, rows };
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error("logs unavailable");
}

/** All logs of one event (optionally filtered by indexed args) from fromBlock to the head, decoded, oldest first.
 *  `key` names the series in KV (keep it stable per address + event + filter). Throws only if nothing at all could
 *  be read and nothing was stored. */
export async function cachedLogs<A>(net: Net, key: string, q: { address: Address; event: AbiEvent; args?: Record<string, unknown>; fromBlock: bigint }): Promise<{ args: A; blockNumber: bigint }[]> {
  const k = `logs:${net.chain.id}:${key}`;
  const now = Date.now();
  let cur = mem.get(k)?.v;
  if (!cur || now - mem.get(k)!.at > MEM_MS) {
    const stored = kvOn ? await kv<string>("GET", k) : null;
    const fromKv = stored ? (JSON.parse(stored) as Stored) : null;
    // whichever copy has read further
    if (fromKv && (!cur || BigInt(fromKv.to) > BigInt(cur.to))) cur = fromKv;
    const from = cur ? BigInt(cur.to) + 1n : q.fromBlock;
    try {
      const got = await fetchRange(net, q, from);
      cur = { to: got.to.toString(), rows: [...(cur?.rows ?? []), ...got.rows] };
      if (kvOn && (!fromKv || got.rows.length > 0 || got.to - BigInt(fromKv.to) > RESAVE_BLOCKS)) await kv("SET", k, JSON.stringify(cur));
    } catch (e) {
      if (!cur) throw e; // nothing stored yet: let the caller fall back
    }
    mem.set(k, { at: now, v: cur });
  }
  return cur.rows.map((r) => ({ blockNumber: BigInt(r.b), args: dec(r.args) as A }));
}
