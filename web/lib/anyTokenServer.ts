import "server-only";
import { createPublicClient, encodeFunctionData, getAddress, http, isAddress, parseAbi, type Address, type PublicClient } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "./serverRpc";
import { tw } from "./trustware";
import { computeGuard, guardRoute, type Guard } from "./v4guard";
import { readSafety } from "./safety";
import { NATIVE_ZERO, sameAddr } from "./bridge";
import { DST_CHAIN, MAX_USD, capUsdOf, checkAnyQuote, depositIdOf, sourceOk, usdOf, type AnyQuote } from "./anychain";
import { CROSS_BUY, ETH_SHARE, MAX_IMPACT_PCT, MAX_TRIP_LOSS_PCT, MIN_OUT_BPS, type AnyTokenQuote } from "./anyToken";
import { realTrip, type Route } from "./anyTokenTrip";
import { TICKET_TTL_S, signTicket, stoaPrices } from "./anychainServer";

/** Buy any Robinhood Chain token from another chain, in one signature.
 *
 *  Trustware routes the source deposit through Relay to Robinhood Chain as an exact amount of ETH, delivered with a
 *  call to StoaCrossBuy (contracts/src/tools/StoaCrossBuy.sol), which swaps all of it through the Stoa router into the
 *  token for the buyer, or sends the ETH to the buyer if the swap fails (price moved past the minimum, deadline passed,
 *  route gone). Stoa builds that call itself, from its own router quote, and checks the source deposit exactly as for
 *  $STOA (checkAnyQuote). Before any route is asked for, the token is checked three ways and refused unless all pass:
 *  Stoa's safety check must have run and not flagged it; the purchase must not move its price by more than
 *  MAX_IMPACT_PCT; and the purchase itself, run at the real size with the real call, must leave the buyer's own address
 *  able to sell and send the token, losing no more than MAX_TRIP_LOSS_PCT on the way back (lib/anyTokenTrip.ts). None of
 *  this proves the token stays sellable afterwards. */

const EVM_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const routerAbi = parseAbi([
  "function quote(address,address,uint256) returns ((uint256 amountOut, address mid, (address venue, bool isPool) leg1, (address venue, bool isPool) leg2))",
]);
const buyAbi = parseAbi([
  "function buy(address tokenOut, address mid, (address venue, bool isPool) leg1, (address venue, bool isPool) leg2, uint256 minOut, address to, uint256 deadline, address referrer) payable returns (uint256)",
]);
const erc20 = parseAbi(["function decimals() view returns (uint8)"]);
/** how long the destination call stays valid; past it the swap is skipped and the ETH goes to the buyer */
const DEADLINE_S = 3600;

function rhClient() {
  const rpc = (ROBINHOOD.chain.rpcUrls.default.http as readonly string[])[0] ?? ROBINHOOD.logsRpc;
  return createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(rpc), { fetchOptions: { headers: { "user-agent": "curl/8.5.0" } }, timeout: 10_000 }) });
}

export type AnyTokenAsk = { chainId: number; token: string; amount: bigint; user: string; tokenOut: string };

/** the quote, or an error with an HTTP status */
export async function anyTokenQuote(a: AnyTokenAsk): Promise<{ q: AnyTokenQuote } | { error: string; status: number }> {
  if (!sourceOk(a.chainId, a.token) || !isAddress(a.user, { strict: false }) || !isAddress(a.tokenOut, { strict: false }) || a.amount <= 0n) return { error: "bad request", status: 400 };
  const tokenOut = getAddress(a.tokenOut), user = getAddress(a.user);
  if (sameAddr(tokenOut, ZERO) || sameAddr(tokenOut, ROBINHOOD.wrapped)) return { error: "To get ETH on Robinhood Chain, use Bridge in.", status: 400 };
  const native = sameAddr(a.token, NATIVE_ZERO);
  const want = { user, chainId: a.chainId, token: a.token as Address, amount: a.amount };

  const px = await stoaPrices();
  const ethUsd = px.ethUsd;
  if (!ethUsd) return { error: "busy", status: 503 };
  const forCap = capUsdOf(want, ethUsd), usd = usdOf(want, ethUsd);
  if (forCap === null || usd === null) return { error: "busy", status: 503 };
  if (forCap > MAX_USD) return { error: `Buying from another chain is limited to $${MAX_USD} per purchase for now. Use a smaller amount.`, status: 422 };

  // the token first: a token that fails Stoa's safety check is not bought from another chain
  const safety = await readSafety(ROBINHOOD, tokenOut).catch(() => null);
  if (!safety) return { error: "Stoa could not check this token right now. Try again in a minute.", status: 503 };
  if (safety.verdict === "danger") return { error: `Stoa's safety check flags ${safety.symbol}: ${safety.notes[0] ?? "it may not be sellable"}. Stoa will not buy it from another chain.`, status: 422 };
  // a check that did not run is not a pass (HEY Research Lab, any-token review, F-2)
  if (safety.verdict === "unknown") return { error: `Stoa could not test ${safety.symbol}${safety.notes[0] ? `: ${safety.notes[0]}` : ""}. Stoa will not buy an untested token from another chain.`, status: 422 };

  // the ETH to deliver: most of the purchase's value, the rest pays the route (Relay works out the exact source amount)
  const fund = native ? (a.amount * BigInt(Math.round(ETH_SHARE * 10_000))) / 10_000n : BigInt(Math.floor((usd * ETH_SHARE) / ethUsd * 1e6)) * 10n ** 12n;
  if (fund <= 0n) return { error: "Amount too small.", status: 422 };

  const c = rhClient();
  const g = await Promise.race([computeGuard(), new Promise<Guard>((_, no) => setTimeout(() => no(new Error("slow")), 6_000))]).catch((): Guard => ({ oldInRouter: true, poisoned: ["*"] }));
  const routeOf = async (tin: Address, tout: Address, amt: bigint): Promise<Route | null> => {
    try {
      const { result } = await c.simulateContract({ address: ROBINHOOD.contracts.router!, abi: routerAbi, functionName: "quote", args: [tin, tout, amt] });
      return await guardRoute(c as unknown as PublicClient, ROBINHOOD, tin, tout, amt, result, g);
    } catch { return null; }
  };
  const small = fund / 1000n > 0n ? fund / 1000n : 1n;
  const [route, probe] = await Promise.all([routeOf(ZERO, tokenOut, fund), routeOf(ZERO, tokenOut, small)]);
  if (!route || route.amountOut === 0n || !probe || probe.amountOut === 0n) return { error: "Stoa has no route to this token on Robinhood Chain right now.", status: 422 };
  // price impact: what this size gets per ETH against what a tiny purchase gets
  const impactPct = Math.max(0, (1 - (Number(route.amountOut) / Number(fund)) / (Number(probe.amountOut) / Number(small))) * 100);
  if (impactPct > MAX_IMPACT_PCT) return { error: `This purchase would move ${safety.symbol}'s price by about ${impactPct.toFixed(1)}% on Robinhood Chain; the limit is ${MAX_IMPACT_PCT}%. Use a smaller amount.`, status: 422 };
  // what the tokens bought are worth at the price before the purchase, in dollars
  const valueUsd = (Number(route.amountOut) * (Number(small) / Number(probe.amountOut)) / 1e18) * ethUsd;
  const minOut = (route.amountOut * BigInt(MIN_OUT_BPS)) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_S);
  const callData = encodeFunctionData({ abi: buyAbi, functionName: "buy", args: [tokenOut, route.mid, route.leg1, route.leg2, minOut, user, deadline, ZERO] });

  // gas for the destination call, measured on Robinhood Chain as the relayer would send it
  let gas: bigint;
  try {
    const relayer = "0x000000000000000000000000000000000000dEaD" as Address;
    gas = await c.estimateGas({ account: relayer, to: CROSS_BUY, data: callData, value: fund, stateOverride: [{ address: relayer, balance: fund * 2n + 10n ** 18n }] });
    gas = (gas * 13n) / 10n;
  } catch { gas = 4_000_000n; }

  // the purchase itself, at the real size, then a sale and a transfer from the buyer's own address (lib/anyTokenTrip.ts)
  const sell = await routeOf(tokenOut, ZERO, (minOut * 999n) / 1000n);
  const trip = await realTrip(c as unknown as PublicClient, { user, tokenOut, fund, route, minOut, deadline, gas, sell });
  if (!trip.ok) return { error: trip.why, status: trip.status };
  if (trip.lossPct > MAX_TRIP_LOSS_PCT) return { error: `Bought and sold straight back at this size, ${safety.symbol} loses about ${trip.lossPct.toFixed(1)}% (a tax or a thin pool); the limit is ${MAX_TRIP_LOSS_PCT}%. Stoa will not buy it from another chain.`, status: 422 };

  const [decimals] = await Promise.all([c.readContract({ address: tokenOut, abi: erc20, functionName: "decimals" }).catch(() => 18)]);
  const r = await tw("/routes/route", {
    method: "POST",
    body: JSON.stringify({
      fromChain: String(a.chainId), toChain: String(DST_CHAIN), fromToken: native ? EVM_NATIVE : a.token, toToken: EVM_NATIVE,
      fromAmount: a.amount.toString(), fromAddress: user, toAddress: user, refundAddress: user, slippageBps: 100,
      hooks: { postHook: { target: CROSS_BUY, callData, value: fund.toString(), fundToken: EVM_NATIVE, fundAmount: fund.toString(), toFallbackAddress: user, estimatedGas: gas.toString(), description: `Buy ${safety.symbol} on Stoa` } },
    }),
  });
  const d = (r.body.data ?? {}) as { intentId?: string; expiresAt?: string; route?: { provider?: string; estimate?: AnyQuote["estimate"]; execution?: { transaction?: AnyQuote["transaction"]; approvals?: AnyQuote["approvals"] } } };
  if (!r.ok || !d.intentId || !d.route?.estimate || !d.route.execution?.transaction) {
    return { error: r.status === 429 ? "busy" : "No route from that chain for this amount right now. Try another amount.", status: r.status === 429 ? 429 : 404 };
  }
  const est = d.route.estimate;
  // the route asks for the exact source amount itself (it never takes more than was typed), then delivers exactly `fund`
  let paid: bigint;
  try { paid = BigInt(est.fromAmount); } catch { return { error: "no checkable route", status: 422 }; }
  if (paid <= 0n || paid > a.amount || BigInt(est.toAmountMin) !== fund || BigInt(est.toAmount) !== fund) return { error: "no checkable route", status: 422 };
  const q: AnyTokenQuote = {
    intentId: d.intentId, expiresAt: d.expiresAt, provider: String(d.route.provider ?? ""), estimate: est,
    transaction: d.route.execution.transaction, approvals: d.route.execution.approvals ?? [], ethUsd, stoaPerUsd: null,
    tokenOut, symbol: safety.symbol, decimals: Number(decimals), ethFund: fund.toString(), expectedOut: route.amountOut.toString(),
    minOut: minOut.toString(), deadline: Number(deadline), safety: { verdict: safety.verdict, notes: safety.notes.slice(0, 3) },
    impactPct: Number(impactPct.toFixed(2)), valueUsd: Number(valueUsd.toFixed(2)), tripLossPct: trip.lossPct,
  };
  const why = checkAnyQuote(q, { ...want, amount: paid });
  if (why) return { error: why.startsWith("Buying") ? why : "no checkable route", status: 422 };
  q.exp = Math.floor(Date.now() / 1000) + TICKET_TTL_S;
  q.sig = signTicket({ intentId: d.intentId, user, chainId: a.chainId, depositId: depositIdOf(q.transaction.data)!, exp: q.exp });
  return { q };
}
