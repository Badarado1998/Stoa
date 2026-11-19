import "server-only";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "@/lib/serverRpc";
import { STOA_RH } from "./anychain";

/** Stoa's signature of a Trustware intent id, returned with each quote. /status and /receipt only forward intents that
 *  carry it, so nobody can spend the Trustware key's rate limit on ids Stoa never issued. Keyed from the Trustware key
 *  itself, so there is no extra secret to manage. */
function key() {
  const k = process.env.TRUSTWARE_API_KEY;
  if (!k) throw new Error("not configured");
  return createHash("sha256").update(`stoa-anychain-intent:${k}`).digest();
}
export function signIntent(intentId: string) {
  return createHmac("sha256", key()).update(intentId).digest("hex");
}
export function intentOk(intentId: string, sig: string) {
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  try {
    return timingSafeEqual(Buffer.from(signIntent(intentId), "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
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
  const [e, s] = await Promise.allSettled([
    c.simulateContract({ address: router, abi: routerAbi, functionName: "quote", args: [ZERO, USDG, 10n ** 16n] }),
    c.simulateContract({ address: router, abi: routerAbi, functionName: "quote", args: [USDG, STOA_RH, 10n * 10n ** 6n] }),
  ]);
  const ethUsd = e.status === "fulfilled" && e.value.result.amountOut > 0n ? (Number(e.value.result.amountOut) / 1e6) * 100 : null;
  const stoaPerUsd = s.status === "fulfilled" && s.value.result.amountOut > 0n ? Number(s.value.result.amountOut) / 1e18 / 10 : null;
  return { ethUsd, stoaPerUsd };
}
