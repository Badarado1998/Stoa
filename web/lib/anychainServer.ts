import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createPublicClient, fallback, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "@/lib/serverRpc";
import { STOA_RH } from "./anychain";
import { SOURCES } from "./bridge";
import { computeGuard, guardRoute, type Guard } from "./v4guard";

/** Stoa's signature of a quote it issued: the Trustware intent id, the buyer, the source chain and the Relay order id
 *  in the deposit call. /status and /receipt only act on quotes that carry it, so ids Stoa never issued never reach
 *  Trustware, and a receipt can only commit a transaction from that buyer carrying that order id. Keyed from its own
 *  secret (ANYCHAIN_HMAC_SECRET) so rotating the Trustware key does not drop purchases in flight; derived from the
 *  Trustware key only when that secret is not set. */
function key() {
  const own = process.env.ANYCHAIN_HMAC_SECRET;
  if (own && own.length >= 32) return createHash("sha256").update(`stoa-anychain-ticket:${own}`).digest();
  const k = process.env.TRUSTWARE_API_KEY;
  if (!k) throw new Error("not configured");
  return createHash("sha256").update(`stoa-anychain-intent:${k}`).digest();
}
export interface Ticket { intentId: string; user: string; chainId: number; depositId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function signTicket(t: Ticket) {
  return createHmac("sha256", key()).update(`${t.intentId.toLowerCase()}|${t.user.toLowerCase()}|${t.chainId}|${t.depositId.toLowerCase()}`).digest("hex");
}
/** a ticket from a request (query or JSON body), or null when it is malformed or not Stoa's */
export function readTicket(v: { intentId?: unknown; user?: unknown; chainId?: unknown; depositId?: unknown; sig?: unknown }): Ticket | null {
  const t: Ticket = { intentId: String(v.intentId ?? ""), user: String(v.user ?? ""), chainId: Number(v.chainId), depositId: String(v.depositId ?? "") };
  const sig = String(v.sig ?? "");
  if (!UUID.test(t.intentId) || !isAddress(t.user, { strict: false }) || !SOURCES.some((s) => s.chain.id === t.chainId)) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(t.depositId) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  try {
    return timingSafeEqual(Buffer.from(signTicket(t), "hex"), Buffer.from(sig, "hex")) ? t : null;
  } catch {
    return null;
  }
}
/** true when a JSON body was sent as JSON (a text/plain body from another site's page is refused) */
export const isJson = (req: Request) => (req.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim() === "application/json";

const SOURCE_RPC: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com", 8453: "https://base-rpc.publicnode.com", 42161: "https://arb1.arbitrum.io/rpc",
  10: "https://mainnet.optimism.io", 56: "https://bsc-rpc.publicnode.com",
};
/** a read-only client for a source chain */
export function sourceClient(chainId: number) {
  const s = SOURCES.find((x) => x.chain.id === chainId)!;
  const ua = { fetchOptions: { headers: { "user-agent": "curl/8.5.0" } }, timeout: 8_000 };
  return createPublicClient({ chain: s.chain, transport: fallback([http(SOURCE_RPC[chainId], ua), http(undefined, ua)]) });
}

const routerAbi = parseAbi(["function quote(address,address,uint256) returns ((uint256 amountOut, address mid, (address venue, bool isPool) leg1, (address venue, bool isPool) leg2))"]);
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Stoa's own prices from its router on Robinhood Chain: USD per ETH (0.01 ETH → USDG) and $STOA per USD (10 USDG →
 *  $STOA). Either is null when the chain does not answer. */
export async function stoaPrices(): Promise<{ ethUsd: number | null; stoaPerUsd: number | null }> {
  const rpc = (ROBINHOOD.chain.rpcUrls.default.http as readonly string[])[0] ?? ROBINHOOD.logsRpc;
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(rpc), { fetchOptions: { headers: { "user-agent": "curl/8.5.0" } }, timeout: 8_000 }) });
  const router = ROBINHOOD.contracts.router!;
  const [e, s, g] = await Promise.allSettled([
    c.simulateContract({ address: router, abi: routerAbi, functionName: "quote", args: [ZERO, USDG, 10n ** 16n] }),
    c.simulateContract({ address: router, abi: routerAbi, functionName: "quote", args: [USDG, STOA_RH, 10n * 10n ** 6n] }),
    Promise.race([computeGuard(), new Promise<Guard>((_, no) => setTimeout(() => no(new Error("slow")), 6_000))]),
  ]);
  // the ETH price goes through the same V4 guard as every other Stoa quote (lib/v4guard). When the guard can't be
  // read in time, every pair counts as suspect and the price is read without the first V4 adapter, as /api/v1/quote does.
  const guard: Guard = g.status === "fulfilled" ? g.value : { oldInRouter: true, poisoned: ["*"] };
  let ethUsd: number | null = null;
  if (e.status === "fulfilled") {
    const r = await guardRoute(c as unknown as PublicClient, ROBINHOOD, ZERO, USDG, 10n ** 16n, e.value.result, guard).catch(() => null);
    if (r && r.amountOut > 0n) ethUsd = (Number(r.amountOut) / 1e6) * 100;
  }
  const stoaPerUsd = s.status === "fulfilled" && s.value.result.amountOut > 0n ? Number(s.value.result.amountOut) / 1e18 / 10 : null;
  return { ethUsd, stoaPerUsd };
}
