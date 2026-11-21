import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { stockTokens, type Stock } from "@/lib/stocks";
import { ldJson } from "@/lib/ldJson";

// /buy-stocks: the guide for "how do I buy stocks on-chain / on Robinhood Chain", the search a stock page alone does not
// answer. What Robinhood Stock Tokens are, the steps from any chain, the two prices, weekends, costs, and the stocks Stoa
// can swap right now, each linking to its own page. Regenerated every 10 minutes.
export const revalidate = 600;
const title = "How to buy stock tokens on Robinhood Chain";
const description = "Buy tokenized US stocks such as TSLA, NVDA or AAPL on Robinhood Chain with ETH or USDG: what Robinhood Stock Tokens are, the steps from any chain, why the on-chain price can differ from Robinhood's, weekend trading and costs.";
export const metadata: Metadata = {
  title, description, alternates: { canonical: "/buy-stocks" },
  openGraph: { title: `${title} · Stoa`, description, type: "article", siteName: "Stoa" },
  twitter: { card: "summary_large_image", site: "@StoaDex", title: `${title} · Stoa`, description },
};

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 2 : 4 })}`;
const STEPS: [string, React.ReactNode, string][] = [
  ["Get a wallet", <>Any EVM wallet works, such as MetaMask, Rabby or OKX Wallet. Stock tokens stay in your own wallet: no brokerage account.</>, "Use any EVM wallet such as MetaMask, Rabby or OKX Wallet."],
  ["Have ETH or USDG on Robinhood Chain", <>Already on Robinhood Chain? Skip ahead. Holding ETH, USDC or USDT on Ethereum, Base, Arbitrum, Optimism or BNB Chain? <Link href="/bridge">Bridge</Link> it to the same wallet on Robinhood Chain, as ETH or USDG.</>, "Bridge ETH, USDC or USDT from Ethereum, Base, Arbitrum, Optimism or BNB Chain to Robinhood Chain."],
  ["Pick the stock and read both prices", <>Open the stock&apos;s page from the list below. It shows Robinhood&apos;s price next to the on-chain price, and how far apart they are right now.</>, "Open the stock's page and compare Robinhood's price with the on-chain price."],
  ["Swap on Stoa", <>Enter an amount. Stoa compares every venue it routes for that exact amount and shows the rate, the 2 bps fee, price impact and the minimum you receive. Confirm in your wallet; the token arrives in the same wallet.</>, "Enter an amount, read the quote and confirm in your wallet."],
];
const FAQ: [string, string][] = [
  ["What is a Robinhood Stock Token?", "An ERC-20 token on Robinhood Chain, issued by Robinhood Assets (Jersey) Limited, that tracks a US stock or ETF. It is held in your own wallet and swapped on-chain like any other token."],
  ["Can everyone buy them?", "No. Robinhood's stock tokens are not offered in every country, and the issuer's terms decide who may hold them. Check that they are available where you live before you buy."],
  ["Why can the on-chain price differ from Robinhood's?", "Robinhood's price follows the underlying shares. The on-chain price is what the token last traded for in its pool, so it drifts when the pool is thin or when the US market is closed. Stoa shows both before you swap."],
  ["Can I trade on weekends?", "Yes, the pools trade 24/7. While the US market is closed Robinhood's price stays frozen, so the gap can widen: check it before you swap."],
  ["What does it cost?", "A 2 bps (0.02%) protocol fee, already counted in the quote, plus Robinhood Chain gas, usually a few cents of ETH."],
];

export default async function BuyStocks() {
  const all = (await stockTokens().catch(() => null))?.stocks ?? [];
  const routed: Stock[] = all.filter((s) => s.route && s.dex).sort((a, b) => (b.dex?.volume24h ?? 0) - (a.dex?.volume24h ?? 0)).slice(0, 24);
  const howTo = { "@context": "https://schema.org", "@type": "HowTo", name: title, step: STEPS.map(([n, , t], i) => ({ "@type": "HowToStep", position: i + 1, name: n, text: t })) };
  const faqLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return (
    <section className="page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(howTo) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faqLd) }} />
      <PageHead eyebrow="GUIDE · STOCK TOKENS" title={title} action={<Link className="cta" href="/stocks">All stock tokens</Link>}>
        Tokenized US stocks and ETFs, held in your own wallet and swappable at any hour. {routed.length ? `${all.filter((s) => s.route).length} of them can be swapped on Stoa right now.` : ""}
      </PageHead>
      <div className="panel pad uline">
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12, lineHeight: 1.55 }}>
          {STEPS.map(([n, b]) => <li key={n}><b>{n}.</b> {b}</li>)}
        </ol>
      </div>
      {routed.length > 0 && (
        <div className="panel pad">
          <div className="lbl">SWAPPABLE ON STOA NOW · MOST TRADED FIRST</div>
          <ul className="list">
            {routed.map((s) => {
              const mid = s.bid != null && s.ask != null ? (s.bid + s.ask) / 2 : null;
              const gap = mid && s.dex ? (s.dex.priceUsd / mid - 1) * 100 : null;
              return (
                <li key={s.address}>
                  <span><Link href={`/stocks/${s.symbol.toLowerCase()}`}>How to buy {s.symbol}</Link> · {s.name}</span>
                  <b>{s.dex ? usd(s.dex.priceUsd) : "—"}{gap != null ? ` · ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}% vs Robinhood` : ""}</b>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="panel pad">
        <div className="lbl">QUESTIONS</div>
        {FAQ.map(([q, a]) => <div key={q} style={{ marginTop: 12 }}><b>{q}</b><p style={{ margin: "4px 0 0", lineHeight: 1.55 }}>{a}</p></div>)}
      </div>
      <p className="note">Prices are read from Robinhood and from on-chain pools and change all the time. Nothing here is financial advice.</p>
    </section>
  );
}
