import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACTS, addressUrl, elysium } from "@/lib/chain";
import { USDC, WHYPE } from "@/lib/tokens";
import { PageHead } from "@/components/ui";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = { title: "Build" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const SOL = `// 1. off-chain: route = router.quote(USDC, WHYPE, 250e6)  (eth_call)
// 2. on-chain: follow the route with your limits
IStoaRouter.SwapParams memory p = IStoaRouter.SwapParams({
  tokenIn: USDC, tokenOut: WHYPE,       // address(0) = native HYPE
  mid: route.mid,                       // zero for a direct swap
  leg1: route.leg1, leg2: route.leg2,   // allowlisted venues only
  amountIn: 250e6,
  minOut: route.amountOut * 995 / 1000, // 0.5% slippage
  to: msg.sender, deadline: block.timestamp + 60,
  referrer: address(0)
});
IStoaRouter(router).swap(p);`;
const TS = `// best route across Stoa pools and Uniswap, direct or via WHYPE
const { result: route } = await client.simulateContract({
  address: ROUTER, abi: routerAbi,
  functionName: 'quote',
  args: [USDC, WHYPE, 250_000_000n],
})
// route.amountOut, route.mid, route.leg1, route.leg2
// then: writeContract({ functionName: 'swap', args: [{ ...route, ... }] })`;

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
            {stoa.map(([n, a]) => <li key={n}>{n} {a ? <span className="addr">{addressUrl(a) ? <a href={addressUrl(a)} target="_blank" rel="noopener noreferrer"><code>{short(a)}</code></a> : <code>{short(a)}</code>}<CopyButton text={a} /></span> : <b>Deploying soon</b>}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
