import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Hex } from "viem";
import { API_HEADERS, apiError, apiQuote, limited } from "@/lib/api";
import { ROBINHOOD } from "@/lib/networks";
import { PAY_MAX_USDG, withTag } from "@/lib/pay";
import { stockTokens } from "@/lib/stocks";

// GET /api/pay/quote?token=0x…|native&amount=<USDG units>&payer=0x…&to=0x…[&get=<stock>][&id=<16 hex>][&referrer=0x…]
// Stoa Pay on Robinhood Chain: the transaction that pays `to` what the request asks, from `token`.
//  - Paid out in USDG: `to` receives at least `amount` USDG (the swap's minOut is exactly that).
//  - Paid out in a stock token (`get`): `to` receives at least what `amount` USDG buys of it now, less 0.5%.
// Paying in the payout token itself is a plain transfer. The request id, if any, is appended to the calldata.
export const dynamic = "force-dynamic";

const USDG = ROBINHOOD.stable;
const lc = (s: string) => s.toLowerCase();
// how much more than the reverse quote to put in: covers the fee, price impact both ways and a moving price
const BUFFERS = [1.004, 1.008, 1.015, 1.03, 1.06];
const STOCK_FLOOR_BPS = 9_950n;

export async function GET(req: Request) {
  const block = limited(req);
  if (block) return block;
  const u = new URL(req.url).searchParams;
  const token = u.get("token") ?? "", amt = u.get("amount") ?? "", payer = u.get("payer") ?? "", to = u.get("to") ?? "";
  const get = u.get("get") ?? "", id = u.get("id") ?? "";
  const referrer = u.get("referrer") ?? undefined;
  if (!isAddress(payer, { strict: false }) || !isAddress(to, { strict: false })) return apiError(400, "payer and to must be addresses");
  if (!/^\d{1,30}$/.test(amt) || BigInt(amt) === 0n) return apiError(400, "amount must be a positive integer in USDG units");
  const amount = BigInt(amt);
  if (amount > BigInt(PAY_MAX_USDG) * 1_000_000n) return apiError(400, `Stoa Pay is limited to ${PAY_MAX_USDG} USDG per payment`);
  if (token !== "native" && !isAddress(token, { strict: false })) return apiError(400, "token must be an address or native");
  if (id && !/^[0-9a-f]{16}$/i.test(id)) return apiError(400, "id must be 16 hex characters");
  const tokenIn = token === "native" ? "native" : getAddress(token);

  // what the requester receives, and at least how much
  let out = getAddress(USDG), target = amount;
  if (get && lc(get) !== lc(USDG)) {
    if (!isAddress(get, { strict: false })) return apiError(400, "get must be a stock token address");
    const { stocks } = await stockTokens();
    const s = stocks.find((x) => lc(x.address) === lc(get));
    if (!s) return apiError(400, "Payouts can be in USDG or a Robinhood stock token");
    if (s.halted) return apiError(422, `${s.symbol} is halted right now, so it cannot be paid out. Try again when it trades.`);
    out = getAddress(s.address);
    const r = await apiQuote({ chain: "robinhood", sellToken: USDG, buyToken: out, amount: amount.toString() });
    if (!r.ok) return apiError(422, `No route to ${s.symbol} right now`);
    target = (BigInt(((await r.json()) as { amountOut: string }).amountOut) * STOCK_FLOOR_BPS) / 10_000n;
    if (target === 0n) return apiError(422, `No route to ${s.symbol} right now`);
  }
  const payment = { amount: amount.toString(), to: getAddress(to), get: out, minOut: target.toString() };

  // paying in the payout token itself: a transfer of exactly the minimum
  if (tokenIn !== "native" && lc(tokenIn) === lc(out)) {
    const data = withTag(encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(to), target] }), id || undefined);
    return Response.json({ transfer: true, amountIn: target.toString(), amountOut: target.toString(), tx: { to: out, chainId: ROBINHOOD.chain.id, value: "0", data }, payment }, { headers: API_HEADERS });
  }

  const swap = async (amountIn: bigint) => apiQuote({
    chain: "robinhood", sellToken: tokenIn, buyToken: out, amount: amountIn.toString(),
    taker: getAddress(payer), recipient: getAddress(to), referrer, deadlineSeconds: "300", minOutExact: target,
  });
  const done = (j: Record<string, unknown> & { tx: { data: Hex } }) =>
    Response.json({ ...j, tx: { ...j.tx, data: withTag(j.tx.data, id || undefined) }, payment }, { headers: API_HEADERS });

  // USDG into a stock payout: exactly the amount asked goes in
  if (tokenIn !== "native" && lc(tokenIn) === lc(USDG)) {
    const r = await swap(amount);
    if (!r.ok) return apiError(422, "The price moved: try again in a few seconds");
    return done((await r.json()) as Record<string, unknown> & { tx: { data: Hex } });
  }

  // anything else: about how much of `token` the payout is worth, then a little more until the swap clears the minimum
  const rev = await apiQuote({ chain: "robinhood", sellToken: out, buyToken: tokenIn, amount: target.toString() });
  if (!rev.ok) return apiError(422, "No route for this token right now");
  const base = BigInt(((await rev.json()) as { amountOut: string }).amountOut);
  if (base === 0n) return apiError(422, "No route for this token right now");
  for (const b of BUFFERS) {
    const r = await swap((base * BigInt(Math.round(b * 10_000))) / 10_000n);
    if (!r.ok) continue;
    const j = (await r.json()) as Record<string, unknown> & { amountOut: string; tx: { data: Hex } };
    // keep 0.2% of headroom over the minimum, so the swap still clears if the price moves a little before it lands
    if (BigInt(j.amountOut) * 1000n < target * 1002n) continue;
    return done(j);
  }
  return apiError(422, "Not enough liquidity to pay this amount with this token right now. Try another token or a smaller amount.");
}
