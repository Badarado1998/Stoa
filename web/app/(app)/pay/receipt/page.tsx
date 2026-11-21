import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient, decodeFunctionData, erc20Abi, formatUnits, getAddress, http, parseEventLogs, type Address, type Hash } from "viem";
import { PageHead } from "@/components/ui";
import { routerAbi } from "@/lib/abi";
import { ROBINHOOD } from "@/lib/networks";
import { srv } from "@/lib/serverRpc";
import { USDG_ADDR, tagIn } from "@/lib/pay";
import { stockTokens } from "@/lib/stocks";

export const metadata: Metadata = { title: "Stoa Pay receipt", robots: { index: false } };
export const dynamic = "force-dynamic";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const NATIVE = "0x0000000000000000000000000000000000000000";
const lc = (s: string) => s.toLowerCase();

type Receipt = { id: string; from: Address; to: Address; outToken: Address; out: { symbol: string; amount: string }; paidWith: { symbol: string; amount: string } | null; at: number; tx: Hash };

async function read(hash: string): Promise<Receipt | string> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return "That is not a transaction hash.";
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc)) });
  const [tx, rc] = await Promise.all([c.getTransaction({ hash: hash as Hash }).catch(() => null), c.getTransactionReceipt({ hash: hash as Hash }).catch(() => null)]);
  if (!tx || !rc) return "Stoa could not find this transaction on Robinhood Chain.";
  if (rc.status !== "success") return "This transaction failed on-chain, so nothing was paid.";
  const id = tagIn(tx.input);
  if (!id) return "This transaction is not a Stoa Pay payment.";
  const meta = async (t: Address) => t === NATIVE ? { symbol: "ETH", decimals: 18 } : {
    symbol: await c.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }).catch(() => "token"),
    decimals: await c.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  };
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: rc.logs });
  let out: Address, to: Address, paidWith: Receipt["paidWith"] = null;
  if (tx.to && lc(tx.to) === lc(ROBINHOOD.contracts.router!)) {
    const d = decodeFunctionData({ abi: routerAbi, data: tx.input });
    if (d.functionName !== "swap") return "This transaction is not a Stoa Pay payment.";
    const p = (d.args as readonly [{ tokenIn: Address; tokenOut: Address; amountIn: bigint; to: Address }])[0];
    out = p.tokenOut; to = p.to;
    const m = await meta(p.tokenIn);
    paidWith = { symbol: m.symbol, amount: formatUnits(p.amountIn, m.decimals) };
  } else if (tx.to) {
    const d = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    if (d.functionName !== "transfer") return "This transaction is not a Stoa Pay payment.";
    out = tx.to; to = d.args[0];
  } else return "This transaction is not a Stoa Pay payment.";
  // Stoa Pay pays out in USDG or a Robinhood stock token, nothing else: a token anyone deployed under the name "USDG"
  // gets no receipt here
  const payouts = new Set([lc(USDG_ADDR), ...((await stockTokens().catch(() => ({ stocks: [] as { address: string }[] }))).stocks.map((x) => lc(x.address)))]);
  if (!payouts.has(lc(out))) return "This transaction is not a Stoa Pay payment: it does not pay out in USDG or a Robinhood stock token.";
  const got = transfers.filter((t) => lc(t.address) === lc(out) && lc(t.args.to) === lc(to)).reduce((s, t) => s + t.args.value, 0n);
  if (got === 0n) return "Stoa could not find the payment in this transaction.";
  const m = await meta(out);
  const blk = await c.getBlock({ blockNumber: rc.blockNumber });
  return { id, from: tx.from, to, outToken: getAddress(out), out: { symbol: m.symbol, amount: formatUnits(got, m.decimals) }, paidWith, at: Number(blk.timestamp), tx: hash as Hash };
}

const num = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: Number(s) < 1 ? 6 : 4 });

export default async function ReceiptPage({ searchParams }: { searchParams: Promise<{ tx?: string }> }) {
  const { tx } = await searchParams;
  const r = await read(tx ?? "");
  return (
    <section className="page">
      <PageHead compact eyebrow="STOA PAY" title="Payment receipt">Read from Robinhood Chain, not from Stoa&apos;s records: anyone can check it on the explorer.</PageHead>
      <div className="panel pad" style={{ maxWidth: 560 }}>
        {typeof r === "string" ? <p>{r}</p> : (
          <>
            <div className="lbl" style={{ color: "#15803d" }}>✓ PAID ON ROBINHOOD CHAIN</div>
            <div style={{ fontSize: 40, fontWeight: 700, margin: "8px 0 4px" }}>{num(r.out.amount)} <span style={{ fontSize: 22 }}>{r.out.symbol}</span></div>
            <div className="det" style={{ marginTop: 12 }}>
              <span>Token</span><span className="mono" style={{ wordBreak: "break-all" }}>{r.outToken}</span>
              <span>To</span><span className="mono" style={{ wordBreak: "break-all" }}>{r.to}</span>
              <span>From</span><span className="mono" style={{ wordBreak: "break-all" }}>{r.from}</span>
              {r.paidWith && <><span>Paid with</span><span>{num(r.paidWith.amount)} {r.paidWith.symbol}, swapped by Stoa</span></>}
              <span>When</span><span>{new Date(r.at * 1000).toUTCString().replace("GMT", "UTC")}</span>
              <span>Request</span><span className="mono">{r.id}</span>
            </div>
            <p style={{ marginTop: 12 }}><a href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noopener noreferrer">See the transaction on Robinhood Chain ↗</a></p>
          </>
        )}
        <p className="note" style={{ marginTop: 12 }}>Need to ask for a payment? <Link href="/pay">Create a link</Link>.</p>
      </div>
    </section>
  );
}
