import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACTS, addressUrl, elysium } from "@/lib/chain";
import { USDC, WHYPE } from "@/lib/tokens";
import { ROBINHOOD, addressUrlOn } from "@/lib/networks";
import { PageHead } from "@/components/ui";
import CopyButton from "@/components/CopyButton";

export const metadata: Metadata = {
  title: "Build",
  description: "Quote, route and swap through Stoa from your own app or contract: router SDK, contract addresses, maker kit and aggregator integration.",
  alternates: { canonical: "/build" },
};
const API = `GET https://stoadex.com/api/v1/quote
  ?chain=robinhood&sellToken=native
  &buyToken=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
  &amount=10000000000000000&slippageBps=50
  &taker=0xYourWallet&referrer=0xYourWallet
→ { amountOut, minOut, route, tx: { to, data, value } }`;
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
const TS = `import { createPublicClient, createWalletClient, custom, http, parseUnits } from 'viem'
import { elysium } from './chain'                    // chain id 99901, rpc.elysium.kinetiq.xyz
import routerAbi from './StoaRouter.json'           // stoadex.com/abi/StoaRouter.json

const ROUTER = '0x104752D50ef893da579Ad813918269e09Ea17dbA'
const USDC = '0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65'
const NATIVE = '0x0000000000000000000000000000000000000000' // HYPE
const pub = createPublicClient({ chain: elysium, transport: http() })
const wallet = createWalletClient({ chain: elysium, transport: custom(window.ethereum) })
const [me] = await wallet.getAddresses()

// 1. best route across every venue, direct or via WHYPE (eth_call, free)
const amountIn = parseUnits('1', 18) // 1 HYPE
const { result: q } = await pub.simulateContract({
  address: ROUTER, abi: routerAbi, functionName: 'quote', args: [NATIVE, USDC, amountIn],
})

// 2. swap along that route with a 0.5% limit
await wallet.writeContract({
  account: me, address: ROUTER, abi: routerAbi, functionName: 'swap', value: amountIn,
  args: [{ tokenIn: NATIVE, tokenOut: USDC, mid: q.mid, leg1: q.leg1, leg2: q.leg2,
    amountIn, minOut: q.amountOut * 995n / 1000n, to: me,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 120), referrer: NATIVE }], // referrer: your address to earn 10%
})
// ERC-20 input: approve the router for amountIn first (or use swapWithPermit2), and send no value`;

export default function BuildPage() {
  const rows: [string, string | undefined][] = [["WHYPE", WHYPE], ["USDC", USDC], ["Permit2", "0x000000000022D473030F116dDEE9F6B43aC78BA3"]];
  const stoa: [string, string | undefined][] = [["StoaRouter", CONTRACTS.router], ["StoaPool (WHYPE/USDC)", CONTRACTS.pool], ["FeeDistributor", CONTRACTS.fees]];
  const R = ROBINHOOD.contracts;
  const rhRows: [string, string][] = [["WETH", ROBINHOOD.wrapped], ["USDG", ROBINHOOD.stable], ["Permit2", "0x000000000022D473030F116dDEE9F6B43aC78BA3"]];
  const rhStoa: [string, string | undefined][] = [["StoaRouter", R.router], ["FeeDistributor", R.fees], ["UniswapV4Adapter", R.v4], ["Admin Safe (2 of 3)", R.safe], ["Timelock (48h)", R.timelock]];
  return (
    <section className="page">
      <PageHead eyebrow="IV · BUILD" title="Every pool is a building block">Quote, route and swap from your own app or contract.</PageHead>
      <div className="panel pad" style={{ marginBottom: 20 }}>
        <div className="rowx"><div className="lbl">HTTP API FOR BOTS · NO KEY</div><Link className="note" style={{ marginTop: 0 }} href="/docs/api">Docs →</Link></div>
        <p style={{ marginTop: 10 }}>One call returns the best route for your amount and the swap transaction to send. Pass your wallet as <code>referrer</code> and earn 10% of Stoa&apos;s fee on every swap your bot sends.</p>
        <pre className="code" style={{ marginTop: 12 }}>{API}</pre>
      </div>
      <div className="panel pad" style={{ marginBottom: 20 }}>
        <div className="rowx"><div className="lbl">BUY CARD FOR YOUR TOKEN PAGE</div><Link className="note" style={{ marginTop: 0 }} href="/docs/embed">Docs →</Link></div>
        <p style={{ marginTop: 10 }}>Put a live &quot;Buy on Stoa&quot; card on your project&apos;s site: price, what a buy gets right now and on which venue, and a button that opens Stoa with your token selected. No wallet connects inside the card. Your wallet earns 10% of Stoa&apos;s fee on every swap it brings.</p>
        <p className="note" style={{ marginTop: 10 }}>Used by <a href="https://nounyagent.com/token" target="_blank" rel="noopener noreferrer">$NOUNY</a> on its token page.</p>
      </div>
      <div className="grid2 eq">
        <div className="panel pad">
          <div className="lbl">TYPESCRIPT (VIEM) · COMPLETE EXAMPLE</div>
          <pre className="code" style={{ marginTop: 12 }}>{TS}</pre>
          <div className="lbl" style={{ marginTop: 18 }}>SOLIDITY</div>
          <pre className="code" style={{ marginTop: 12 }}>{SOL}</pre>
          <p className="note" style={{ marginTop: 14 }}>No npm package yet: use viem or ethers with the router ABI. <a href="/abi/StoaRouter.json" download>Download StoaRouter.json</a></p>
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
          <div className="lbl" style={{ marginTop: 28 }}>ROBINHOOD CHAIN NETWORK</div>
          <ul className="list">
            <li>Chain ID <b>{ROBINHOOD.chain.id}</b></li>
            {rhRows.map(([n, a]) => <li key={n}>{n} <span className="addr"><code>{short(a)}</code><CopyButton text={a} /></span></li>)}
          </ul>
          <div className="lbl" style={{ marginTop: 20 }}>STOA ON ROBINHOOD CHAIN</div>
          <ul className="list">
            {rhStoa.map(([n, a]) => <li key={n}>{n} {a ? <span className="addr"><a href={addressUrlOn(ROBINHOOD, a)} target="_blank" rel="noopener noreferrer"><code>{short(a)}</code></a><CopyButton text={a} /></span> : <b>Deploying soon</b>}</li>)}
          </ul>
          <p className="note">Same router code and ABI on both networks. On Robinhood Chain the native coin is ETH (address(0)) and the hop token is WETH.</p>
        </div>
      </div>
    </section>
  );
}
