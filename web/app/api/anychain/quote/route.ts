import { isAddress, type Address } from "viem";
import { tw } from "@/lib/trustware";
import { DST_CHAIN, STOA_RH, checkAnyQuote, sourceOk, type AnyQuote } from "@/lib/anychain";
import { NATIVE_ZERO, sameAddr } from "@/lib/bridge";

// POST /api/anychain/quote {chainId, token, amount, user}: a Trustware route from a source chain into $STOA on Robinhood
// Chain, to the user's own address. Only Relay depository routes that pass checkAnyQuote are returned; the browser
// checks them again before the wallet opens.
export const dynamic = "force-dynamic";
const EVM_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { chainId?: number; token?: string; amount?: string; user?: string } | null;
  const chainId = Number(b?.chainId), token = String(b?.token ?? ""), user = String(b?.user ?? "");
  let amount: bigint;
  try { amount = BigInt(String(b?.amount ?? "")); } catch { return Response.json({ error: "bad amount" }, { status: 400 }); }
  if (!sourceOk(chainId, token) || !isAddress(user, { strict: false }) || amount <= 0n) return Response.json({ error: "bad request" }, { status: 400 });
  const native = sameAddr(token, NATIVE_ZERO);
  const r = await tw("/routes/route", {
    method: "POST",
    body: JSON.stringify({
      fromChain: String(chainId), toChain: String(DST_CHAIN), fromToken: native ? EVM_NATIVE : token, toToken: STOA_RH,
      fromAmount: amount.toString(), fromAddress: user, toAddress: user, refundAddress: user, slippageBps: 100,
    }),
  });
  const d = (r.body.data ?? {}) as { intentId?: string; expiresAt?: string; route?: { provider?: string; estimate?: AnyQuote["estimate"]; execution?: { transaction?: AnyQuote["transaction"]; approvals?: AnyQuote["approvals"] } } };
  if (!r.ok || !d.intentId || !d.route?.estimate || !d.route.execution?.transaction) {
    return Response.json({ error: r.status === 429 ? "busy" : "no route" }, { status: r.status === 429 ? 429 : 404 });
  }
  const q: AnyQuote = {
    intentId: d.intentId, expiresAt: d.expiresAt, provider: String(d.route.provider ?? ""), estimate: d.route.estimate,
    transaction: d.route.execution.transaction, approvals: d.route.execution.approvals ?? [],
  };
  const why = checkAnyQuote(q, { user: user as Address, chainId, token: token as Address, amount });
  if (why) return Response.json({ error: why.startsWith("Buying") ? why : "no checkable route" }, { status: 422 });
  return Response.json(q, { headers: { "cache-control": "no-store" } });
}
