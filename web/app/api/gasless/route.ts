import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, getAddress, http, isAddress, isHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { limited } from "@/lib/api";
import { ROBINHOOD } from "@/lib/networks";
import { srv } from "@/lib/serverRpc";
import { routerAbi } from "@/lib/abi";
import { GASLESS, GASLESS_PER_DAY, GASLESS_TTL_S, gaslessAbi, type GaslessOrder, type GaslessPermit } from "@/lib/gasless";

// POST /api/gasless {order, signature, permit}: Stoa's relayer submits a signed StoaGasless order on Robinhood Chain and
// pays its gas (lib/gasless.ts, contracts/src/tools/StoaGasless.sol). The contract checks everything that decides the
// outcome (signature, nonce, deadline, minimum out, route); this route only refuses what it will not pay gas for:
// orders that would revert (simulated first), deadlines too far out, and more than GASLESS_PER_DAY orders a wallet a day.
// The relayer key (GASLESS_RELAYER_PRIVATE_KEY, a wallet that holds only gas money) never leaves the server.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const DAY_BLOCKS = 400_000n; // a little over a day of Robinhood Chain blocks

function client() {
  const rpc = (ROBINHOOD.chain.rpcUrls.default.http as readonly string[])[0] ?? ROBINHOOD.logsRpc;
  return http(srv(rpc), { fetchOptions: { headers: { "user-agent": "curl/8.5.0" } }, timeout: 12_000 });
}

function parse(b: unknown): { o: GaslessOrder; sig: Hex; p: GaslessPermit } | null {
  const x = b as { order?: Record<string, unknown>; signature?: unknown; permit?: Record<string, unknown> } | null;
  if (!x?.order || !x.permit || typeof x.signature !== "string" || !isHex(x.signature) || x.signature.length > 2 + 2 * 1024) return null;
  const a = (v: unknown) => (typeof v === "string" && isAddress(v, { strict: false }) ? getAddress(v) : null);
  const n = (v: unknown) => { try { const r = BigInt(String(v)); return r >= 0n ? r : null; } catch { return null; } };
  const o = x.order, p = x.permit;
  const order = {
    owner: a(o.owner), tokenIn: a(o.tokenIn), tokenOut: a(o.tokenOut), amountIn: n(o.amountIn), minOut: n(o.minOut),
    mid: a(o.mid), venue1: a(o.venue1), isPool1: o.isPool1 === true, venue2: a(o.venue2), isPool2: o.isPool2 === true,
    nonce: n(o.nonce), deadline: n(o.deadline),
  };
  const permit = { value: n(p.value), deadline: n(p.deadline), v: Number(p.v), r: p.r, s: p.s };
  if (Object.values(order).some((v) => v === null)) return null;
  if (permit.value === null || permit.deadline === null || !Number.isInteger(permit.v) || permit.v < 0 || permit.v > 255) return null;
  if (typeof permit.r !== "string" || !isHex(permit.r) || permit.r.length !== 66 || typeof permit.s !== "string" || !isHex(permit.s) || permit.s.length !== 66) return null;
  return { o: order as GaslessOrder, sig: x.signature as Hex, p: permit as GaslessPermit };
}

export async function POST(req: Request) {
  const slow = limited(req);
  if (slow) return slow;
  const key = process.env.GASLESS_RELAYER_PRIVATE_KEY;
  if (!GASLESS || !key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return no(503, "Swaps without gas are not open yet.");
  const got = parse(await req.json().catch(() => null));
  if (!got) return no(400, "bad request");
  const { o, sig, p } = got;
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (o.deadline <= now || o.deadline > now + BigInt(GASLESS_TTL_S) + 60n) return no(422, "This signed swap has expired or runs too long. Sign it again.");
  if (o.amountIn === 0n || o.minOut === 0n) return no(422, "bad request");

  const pub = createPublicClient({ chain: ROBINHOOD.chain, transport: client() });
  const relayer = privateKeyToAccount(key as Hex);

  // a wallet's gasless swaps over the last day, from the contract's own events
  try {
    const head = await pub.getBlockNumber();
    const logs = await pub.getContractEvents({ address: GASLESS, abi: gaslessAbi, eventName: "Executed", args: { owner: o.owner as Address }, fromBlock: head > DAY_BLOCKS ? head - DAY_BLOCKS : 0n, toBlock: head });
    if (logs.length >= GASLESS_PER_DAY) return no(429, `Swaps without gas are limited to ${GASLESS_PER_DAY} a day per wallet. Swap with your own ETH, or try again tomorrow.`);
  } catch { /* the cap is a brake; the relayer's own balance is the hard limit */ }

  // the relayer pays only for an order that goes through
  let gas: bigint;
  try {
    // the router's errors too, so a price move reads as Slippage
    await pub.simulateContract({ account: relayer, address: GASLESS, abi: [...gaslessAbi, ...routerAbi], functionName: "execute", args: [o, sig, p] });
    gas = await pub.estimateContractGas({ account: relayer, address: GASLESS, abi: gaslessAbi, functionName: "execute", args: [o, sig, p] });
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const name = r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? "" : "";
    const why: Record<string, string> = {
      BadSignature: "The signature does not match this swap. Sign it again.",
      BadNonce: "This signed swap has already run or was replaced. Sign a new one.",
      Expired: "This signed swap has expired. Sign it again.",
      NativeIn: "ETH cannot be sold without gas; pick a token to sell.",
      ShortTransfer: "This token takes a fee on transfers, which gasless swaps cannot sell.",
      Slippage: "The price moved past your minimum. Get a new quote and sign again.",
    };
    return no(422, why[name] ?? "This swap would fail right now (allowance, balance or price). Get a new quote and sign again.");
  }

  const bal = await pub.getBalance({ address: relayer.address }).catch(() => 0n);
  const gasPrice = await pub.getGasPrice().catch(() => 0n);
  const limit = (gas * 13n) / 10n + 50_000n;
  if (gasPrice === 0n || bal < limit * gasPrice * 2n) return no(503, "Swaps without gas are paused for a moment. Swap with your own ETH, or try again later.");

  try {
    const wallet = createWalletClient({ account: relayer, chain: ROBINHOOD.chain, transport: client() });
    const hash = await wallet.writeContract({ address: GASLESS, abi: gaslessAbi, functionName: "execute", args: [o, sig, p], gas: limit });
    return Response.json({ hash }, { headers: { "cache-control": "no-store" } });
  } catch {
    return no(502, "The relayer could not send this swap. Nothing was taken; try again.");
  }
}
