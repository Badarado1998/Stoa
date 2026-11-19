import { encodeFunctionData, parseAbi } from "viem";
import { tw } from "@/lib/trustware";
import { limited } from "@/lib/api";

// TEMPORARY, preview branch only: does Trustware return a route into Robinhood Chain with a destination call
// (hooks.postHook)? The call is harmless: wrap the delivered ETH as WETH, sent back to the same address. Returns
// Trustware's answer without the key. Never merged to main.
export const dynamic = "force-dynamic";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "production") return Response.json({ error: "off" }, { status: 404 });
  const slow = limited(req);
  if (slow) return slow;
  const u = new URL(req.url);
  const user = u.searchParams.get("user") ?? "0xfe6f7c6e2ad2c3594fe7fb61c28c4499bbb83bf0";
  const fromChain = u.searchParams.get("from") ?? "8453";
  const fromToken = u.searchParams.get("token") ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const amount = u.searchParams.get("amount") ?? "5000000";
  const mode = u.searchParams.get("mode") ?? "native";
  // fixed: fund the call with a set amount of the delivered ETH; patched: Trustware sets the amount (WETH.deposit takes
  // no argument, so the patched variant targets withdrawTo-style calls later; here it only checks the API accepts it)
  const fund = u.searchParams.get("fund") ?? "1000000000000000";
  const hook = mode === "patched"
    ? { target: WETH, callData: encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256)"]), functionName: "transfer", args: [user as `0x${string}`, 0n] }), fundToken: NATIVE, fullAmount: true, amountInputPos: 1, toFallbackAddress: user, estimatedGas: "120000", description: "probe" }
    : { target: WETH, callData: encodeFunctionData({ abi: parseAbi(["function deposit() payable"]), functionName: "deposit" }), value: fund, fundToken: NATIVE, fundAmount: fund, toFallbackAddress: user, estimatedGas: "120000", description: "probe" };
  const body = { fromChain, toChain: "4663", fromToken, toToken: NATIVE, fromAmount: amount, fromAddress: user, toAddress: user, slippageBps: 100, hooks: { postHook: hook } };
  const quote = await tw("/routes/quote", { method: "POST", body: JSON.stringify(body) });
  const route = await tw("/routes/route", { method: "POST", body: JSON.stringify(body) });
  return Response.json({ sent: body, quote: { status: quote.status, body: quote.body }, route: { status: route.status, body: route.body } });
}
