import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead, Ticker } from "@/components/ui";
import { MarketStatus } from "@/components/Stocks";
import { WatchStar } from "@/components/Watch";
import CopyButton from "@/components/CopyButton";
import { mid, stockBySymbol } from "@/lib/stocks";
import { ROBINHOOD, addressUrlOn } from "@/lib/networks";

export const revalidate = 120;

const fmtUsd = (v: number) => (v >= 1 ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "$" + v.toPrecision(3));
const usd0 = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  const hit = await stockBySymbol(symbol).catch(() => null);
  if (!hit) return { title: "Stock token" };
  const { stock: s } = hit;
  const title = `${s.symbol} stock token on Robinhood Chain`;
  const description = `${s.name} (${s.symbol}) as a Robinhood Stock Token: Robinhood's price next to the on-chain price, pool liquidity${s.route ? ", and a swap on Stoa" : ""}. Contract ${s.address}.`;
  return {
    title, description,
    alternates: { canonical: `/stocks/${s.symbol.toLowerCase()}` },
    openGraph: { title: `${title} · Stoa`, description, type: "website", siteName: "Stoa" },
    twitter: { card: "summary_large_image", site: "@StoaDex", title: `${title} · Stoa`, description },
  };
}

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const hit = await stockBySymbol(symbol).catch(() => null);
  if (!hit) notFound();
  const { stock: s, all, updated } = hit;
  const ref = mid(s);
  const diff = ref && s.dex ? ((s.dex.priceUsd - ref) / ref) * 100 : null;
  const swap = `/trade?chain=robinhood&sell=USDG&buy=${s.address}`;
  const more = all.filter((x) => x.route && x.address !== s.address).slice(0, 12);
  const cell = (label: string, v: React.ReactNode, sub?: React.ReactNode) => (
    <div className="panel pad"><div className="lbl">{label}</div><div style={{ fontFamily: "var(--mono)", fontSize: 24, marginTop: 6 }}>{v}</div>{sub && <div className="note" style={{ marginTop: 4 }}>{sub}</div>}</div>
  );
  const ld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Stocks", item: "https://stoadex.com/stocks" },
      { "@type": "ListItem", position: 2, name: `${s.symbol} · ${s.name}`, item: `https://stoadex.com/stocks/${s.symbol.toLowerCase()}` },
    ],
  };
  return (
    <section className="page">
      <p className="note" style={{ margin: "0 0 8px" }}><Link href="/stocks">← All stock tokens</Link></p>
      <PageHead eyebrow="STOCK TOKEN · ROBINHOOD CHAIN" title={`${s.name} (${s.symbol})`}
        action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><MarketStatus /><WatchStar chain="robinhood" address={s.address} symbol={s.symbol} logo={s.logo ?? undefined} via="USDG" label />{s.route ? <Link className="cta" href={swap}>Swap {s.symbol}</Link> : null}</div>}>
        {s.name} as a Robinhood Stock Token on Robinhood Chain. {s.route ? `Stoa routes it: Trade opens with USDG to sell and ${s.symbol} to buy.` : "Stoa has no route to it yet; its pools are checked every day."}
      </PageHead>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.logo ? <img src={s.logo} alt="" width={56} height={56} style={{ borderRadius: 999 }} /> : <Ticker symbol={s.symbol} size={56} />}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, overflowWrap: "anywhere" }}>{s.address}</span>
          <span style={{ display: "flex", gap: 8 }}><CopyButton text={s.address} label="Copy address" /><a className="ghost" href={addressUrlOn(ROBINHOOD, s.address)} target="_blank" rel="noopener noreferrer">Explorer</a></span>
        </div>
      </div>
      <div className="grid3" style={{ marginBottom: 16 }}>
        {cell("ROBINHOOD PRICE", s.halted ? "Halted" : ref ? fmtUsd(ref) : "—", "Mid of Robinhood's bid and ask for one token")}
        {cell("ON-CHAIN PRICE", s.dex ? fmtUsd(s.dex.priceUsd) : "No pool yet", diff != null ? `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}% from Robinhood's price` : undefined)}
        {cell("ON-CHAIN LIQUIDITY", s.dex ? usd0(s.dex.liquidityUsd) : "—", s.dex ? `24h volume ${usd0(s.dex.volume24h)}` : undefined)}
      </div>
      <div className="panel pad" style={{ marginBottom: 16 }}>
        <div className="lbl">HOW THIS WORKS</div>
        <p style={{ marginTop: 8 }}>
          {s.symbol} on Robinhood Chain is a Robinhood Stock Token: an ERC-20 issued by Robinhood Assets (Jersey) Limited that tracks {s.name}. Robinhood&apos;s price follows the underlying shares while the US market, extended hours or the overnight session is open; the on-chain price is what the token trades for in its deepest pool, at any hour.
        </p>
        <p className="note" style={{ marginBottom: 0 }}>
          Stock Tokens are not offered in every country: check Robinhood&apos;s terms for yours. Stoa only routes swaps; nothing here is investment advice. <Link href="/docs/stocks">How Stocks works</Link> · Updated {new Date(updated).toUTCString().slice(17, 22)} UTC.
        </p>
      </div>
      {more.length > 0 && (
        <div className="panel pad">
          <div className="lbl">OTHER STOCK TOKENS ON STOA</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {more.map((m) => <Link key={m.address} className="ghost" href={`/stocks/${m.symbol.toLowerCase()}`}>{m.symbol}</Link>)}
          </div>
        </div>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
    </section>
  );
}
