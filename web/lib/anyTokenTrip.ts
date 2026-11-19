import "server-only";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, maxUint256, numberToHex, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { routerAbi } from "./abi";
import { CROSS_BUY } from "./anyToken";
import { ROBINHOOD } from "./networks";

/** The purchase as it will really happen, run before the buyer signs (HEY Research Lab, any-token review, F-2 and N-1).
 *
 *  One eth_simulateV1 batch on Robinhood Chain, each call seeing the state the one before left:
 *   0. the destination call with the swap's minimum set to the maximum, so the swap fails and StoaCrossBuy refunds the
 *      ETH: if the buyer's address cannot take ETH there (a contract, a 7702 delegation without receive), this reverts
 *      and the quote is refused, as the relayer's own call would revert;
 *   1. the destination call exactly as Stoa built it, at the real size and with the gas Trustware is given;
 *   2-4. from the buyer's own address, with no code: approve the router, sell most of what was bought back through
 *      Stoa, and send one unit to another wallet. A token that lets contracts move it and refuses ordinary wallets
 *      fails here, where the simulator's test (lib/safety.ts) cannot see it.
 *  Nothing is signed or sent. */

const crossBuyAbi = parseAbi([
  "function buy(address tokenOut, address mid, (address venue, bool isPool) leg1, (address venue, bool isPool) leg2, uint256 minOut, address to, uint256 deadline, address referrer) payable returns (uint256)",
]);
type Leg = { venue: Address; isPool: boolean };
export type Route = { amountOut: bigint; mid: Address; leg1: Leg; leg2: Leg };

export type Trip =
  | { ok: true; bought: bigint; ethBack: bigint; sold: bigint; lossPct: number }
  | { ok: false; why: string; status: number };

const rand = (): Address => toHex(crypto.getRandomValues(new Uint8Array(20))) as Address;
type SimCall = { status: Hex; returnData: Hex; error?: { message?: string } };

export async function realTrip(
  c: PublicClient,
  p: { user: Address; tokenOut: Address; fund: bigint; route: Route; minOut: bigint; deadline: bigint; gas: bigint; sell: Route | null },
): Promise<Trip> {
  if (!p.sell || p.sell.amountOut === 0n) return { ok: false, why: "Stoa has no route to sell this token back on Robinhood Chain, so it will not buy it from another chain.", status: 422 };
  const relayer = rand(), other = rand();
  const buyData = (minOut: bigint) => encodeFunctionData({ abi: crossBuyAbi, functionName: "buy", args: [p.tokenOut, p.route.mid, p.route.leg1, p.route.leg2, minOut, p.user, p.deadline, "0x0000000000000000000000000000000000000000"] });
  // sell a little less than the minimum the buy guarantees, so the amount is there whatever the buy returned
  const sellAmt = (p.minOut * 999n) / 1000n;
  if (sellAmt === 0n) return { ok: false, why: "Amount too small.", status: 422 };
  const swapData = encodeFunctionData({
    abi: routerAbi, functionName: "swap",
    args: [{ tokenIn: p.tokenOut, tokenOut: "0x0000000000000000000000000000000000000000", mid: p.sell.mid, leg1: p.sell.leg1, leg2: p.sell.leg2, amountIn: sellAmt, minOut: 1n, to: p.user, deadline: p.deadline, referrer: "0x0000000000000000000000000000000000000000" }],
  });
  const router = ROBINHOOD.contracts.router!;
  const calls = [
    { from: relayer, to: CROSS_BUY, data: buyData(maxUint256), value: numberToHex(p.fund), gas: numberToHex(p.gas) },
    { from: relayer, to: CROSS_BUY, data: buyData(p.minOut), value: numberToHex(p.fund), gas: numberToHex(p.gas) },
    { from: p.user, to: p.tokenOut, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, sellAmt] }), gas: numberToHex(500_000n) },
    // the sale gets ample gas: it tests the token, not the gas Trustware is given
    { from: p.user, to: router, data: swapData, gas: numberToHex(8_000_000n) },
    { from: p.user, to: p.tokenOut, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [other, 1n] }), gas: numberToHex(500_000n) },
  ];
  let res: SimCall[];
  try {
    const out = (await c.request({
      method: "eth_simulateV1" as never,
      // the sale in a later block than the purchase, as a buyer's would be (some pools refuse a round trip in one block)
      params: [{ blockStateCalls: [{ stateOverrides: { [relayer]: { balance: numberToHex(p.fund * 3n + 10n ** 18n) } }, calls: calls.slice(0, 2) }, { calls: calls.slice(2) }], validation: false }, "latest"] as never,
    })) as unknown as { calls: SimCall[] }[];
    res = [...(out?.[0]?.calls ?? []), ...(out?.[1]?.calls ?? [])];
  } catch { return { ok: false, why: "Stoa could not test this purchase right now. Try again in a minute.", status: 503 }; }
  if (res.length !== calls.length) return { ok: false, why: "Stoa could not test this purchase right now. Try again in a minute.", status: 503 };
  const okAt = (i: number) => res[i].status === "0x1";

  if (!okAt(0)) return { ok: false, why: "If the swap failed, the ETH could not be sent back to this address on Robinhood Chain (a smart contract or a delegated wallet there). Use a regular wallet.", status: 422 };
  if (!okAt(1)) return { ok: false, why: "The purchase failed when Stoa tested it on Robinhood Chain. Try a smaller amount.", status: 422 };
  const bought = decodeFunctionResult({ abi: crossBuyAbi, functionName: "buy", data: res[1].returnData });
  if (bought === 0n || bought < p.minOut) return { ok: false, why: "The purchase would be refunded rather than filled at this size. Try a smaller amount.", status: 422 };
  if (!okAt(2) || !okAt(3) || !okAt(4)) return { ok: false, why: "After a test purchase, an ordinary wallet could not sell or send this token. Stoa will not buy it from another chain.", status: 422 };
  const ethBack = decodeFunctionResult({ abi: routerAbi, functionName: "swap", data: res[3].returnData }) as bigint;
  // the ETH the sold part cost, against what it fetched back
  const cost = (p.fund * sellAmt) / bought;
  const lossPct = cost > 0n ? Math.max(0, (1 - Number(ethBack) / Number(cost)) * 100) : 100;
  return { ok: true, bought, ethBack, sold: sellAmt, lossPct: Number(lossPct.toFixed(2)) };
}
