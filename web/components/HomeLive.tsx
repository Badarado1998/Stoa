import Link from "next/link";

/** The plain section under the 3D walk on the home page: what you can do on Stoa today, one line each, and how it is
 *  kept safe. Only features that are live; nothing here quotes a number that is not on-chain. */
const LIVE: { h: string; t: string; d: string; tag?: string }[] = [
  { h: "/trade", t: "Swap", d: "Every venue Stoa routes, compared for your exact amount. Fills where you get the most." },
  { h: "/docs/limit-orders", t: "Limit orders", d: "Sell at a price you set. The keeper fills it through the router, never below your minimum.", tag: "Robinhood" },
  { h: "/docs/trade", t: "Safety check", d: "Before you buy an unverified token, Trade simulates the buy and the sell back: taxes, honeypots, holders." },
  { h: "/cover", t: "Rug Cover", d: "Buy Pons tokens with the creator's ETH bonded behind a 7-day promise not to sell.", tag: "Robinhood" },
  { h: "/launches", t: "Launches", d: "New Pons tokens on their curve or graduated, with what the creator's wallet bought and still holds.", tag: "Robinhood" },
  { h: "/spotlight", t: "Spotlight", d: "Projects bid for a weekly slot; $STOA lockers vote and receive the ETH. Week 1 opens 23 Nov.", tag: "Robinhood" },
  { h: "/portfolio", t: "Portfolio", d: "Every token you hold, with profit and loss for what you bought through Stoa." },
  { h: "/wrapped", t: "Wrapped", d: "Your swaps on Stoa as a trading card you can share." },
  { h: "/docs/api", t: "API for bots", d: "The route and a ready-to-send swap in one call, with your own referrer." },
];

export default function HomeLive() {
  return (
    <section id="live" className="homelive">
      <div className="hl-in">
        <div className="hl-k">ON STOA TODAY</div>
        <h2>Everything you can do, in one place</h2>
        <div className="hl-grid">
          {LIVE.map((f) => (
            <Link key={f.h} href={f.h} className="hl-card">
              <span className="hl-t">{f.t}{f.tag && <small>{f.tag}</small>}</span>
              <span className="hl-d">{f.d}</span>
            </Link>
          ))}
        </div>
        <div className="hl-k" style={{ marginTop: 36 }}>HOW IT IS KEPT SAFE</div>
        <div className="hl-trust">
          <Link href="/docs/security-review"><b>Independent security review</b><span>by Hey Research Lab. Findings are published once fixed.</span></Link>
          <Link href="/docs/admin"><b>48-hour timelock</b><span>on every admin change, signed by a 2-of-3 Safe and public before it runs.</span></Link>
          <a href="https://github.com/StoaDex/Stoa" target="_blank" rel="noopener noreferrer"><b>Open source</b><span>Every contract and this site, on GitHub.</span></a>
          <Link href="/docs/bug-bounty"><b>Bug bounty</b><span>Up to $2,500 for a critical bug, reported on GitHub.</span></Link>
        </div>
        <div className="btns" style={{ marginTop: 28 }}>
          <Link className="cta" href="/trade">Start trading</Link>
          <Link className="ghost" href="/docs">Read the docs</Link>
        </div>
      </div>
    </section>
  );
}
