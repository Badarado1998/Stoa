import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACTS, elysium } from "@/lib/chain";
import { USDC, WHYPE } from "@/lib/tokens";
import { PageHead } from "@/components/ui";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = { title: "Build" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const SOL = `// swap through the Stoa router
IStoaRouter(router).swapExactIn(
  USDC,        // token in
  WHYPE,       // token out
  250e6,       // amount in
  minOut,      // from quoteBest and your slippage
  msg.sender,  // recipient
  deadline,
  address(0)   // referrer
);`;
const TS = `import { createPublicClient, http } from 'viem'

// best of Stoa maker pools and Uniswap, as one call
const { result } = await client.simulateContract({
  address: ROUTER, abi: routerAbi,
  functionName: 'quoteBest',
  args: [USDC, WHYPE, 250_000_000n],
})
// result.amountOut, result.venue, result.isPool`;

export default function BuildPage() {
  const rows: [string, string | undefined][] = [["WHYPE", WHYPE], ["USDC", USDC], ["Permit2", "0x000000000022D473030F116dDEE9F6B43aC78BA3"]];
  const stoa: [string, string | undefined][] = [["StoaRouter", CONTRACTS.router], ["StoaPool (WHYPE/USDC)", CONTRACTS.pool], ["FeeDistributor", CONTRACTS.fees]];
  return (
    <section className="page">
      <PageHead eyebrow="IV · BUILD" title="Every pool is a building block">Quote, route and swap from your own app or contract.</PageHead>
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <div className="panel pad">
          <div className="lbl">TYPESCRIPT (VIEM)</div>
          <pre className="code" style={{ marginTop: 12 }}>{TS}</pre>
          <div className="lbl" style={{ marginTop: 18 }}>SOLIDITY</div>
          <pre className="code" style={{ marginTop: 12 }}>{SOL}</pre>
          <Link className="go" href="/docs/router-sdk">Router and SDK docs</Link>
        </div>
        <div className="panel pad">
          <div className="lbl">ELYSIUM NETWORK</div>
          <ul className="list">
            <li>Chain ID <b>{elysium.id}</b></li>
            {rows.map(([n, a]) => <li key={n}>{n} <span className="addr"><code>{short(a!)}</code><CopyButton text={a!} /></span></li>)}
          </ul>
          <div className="lbl" style={{ marginTop: 20 }}>STOA CONTRACTS</div>
          <ul className="list">
            {stoa.map(([n, a]) => <li key={n}>{n} {a ? <span className="addr"><code>{short(a)}</code><CopyButton text={a} /></span> : <b>Deploying soon</b>}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
