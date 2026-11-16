import type { Metadata } from "next";
import Link from "next/link";
import { CoverChip } from "@/components/CoverPanel";
import { notFound, redirect } from "next/navigation";
import { PageHead } from "@/components/ui";
import CopyButton from "@/components/CopyButton";
import RefKeeper from "@/components/RefKeeper";
import TokenShare from "@/components/TokenShare";
import { findListed, isStoa, listedTokens, priceFmt, readToken, usdFmt } from "@/lib/tokenInfo";

// /tokens/<chain>/<address>: one listed token, its market and Stoa's best route for it right now.
// Rendered on first visit, then kept a minute.
export const revalidate = 60;
export async function generateStaticParams() { return []; }

type P = { params: Promise<{ chain: string; address: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { chain, address } = await params;
  const hit = findListed(chain, address);
  if (!hit) return {};
  const t = await readToken(chain, address).catch(() => null);
  const sym = hit.token.symbol, netName = hit.net.name, url = `/tokens/${hit.net.key}/${hit.token.address}`;
  const title = `Buy ${sym} on ${netName}`;
  const price = t?.priceUsd ? `${sym} trades at ${priceFmt(t.priceUsd)}. ` : "";
  const description = `${price}Swap ${sym} on Stoa: every venue the router uses on ${netName} is compared on every swap. Contract ${hit.token.address}.`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title: `${title} · Stoa`, description, type: "website", siteName: "Stoa", url },
    twitter: { card: "summary_large_image", site: "@StoaDex", title: `${title} · Stoa`, description },
  };
}

export default async function TokenPage({ params }: P) {
  const { chain, address } = await params;
  if (isStoa(chain, address)) redirect("/token"); // $STOA has its own page
  const hit = findListed(chain, address);
  if (!hit) notFound();
  const t = await readToken(chain, address).catch(() => null);
  const { net, token } = hit;
  const sym = token.symbol;
  const buy = `/trade?chain=${net.key}&buy=${token.address}`;
  const sell = `/trade?chain=${net.key}&sell=${token.address}&buy=${net.gas}`;
  const others = listedTokens().filter((x) => x.net.key === net.key && x.token.address !== token.address && x.token.logo).slice(0, 12);
  const ch = t?.change24h ?? null;
  const stat = (label: string, v: string) => (
    <div className="panel pad stat"><div className="lbl">{label}</div><span className="v">{v}</span></div>
  );
  return (
    <section className="page">
      <RefKeeper />
      <PageHead eyebrow={`TOKEN · ${net.name.toUpperCase()}`} title={`Buy ${sym} on Stoa`}
        action={<Link className="cta" href={buy}>Buy {sym}</Link>}>
        Stoa compares every venue it routes on {net.name} on every swap and fills where you get the most, for a 2 bps fee.
      </PageHead>

      <div className="grid2">
        <div className="panel pad">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {token.logo ? <img src={token.logo} alt="" width={52} height={52} style={{ borderRadius: 999, objectFit: "cover", background: "#EAF1FB" }} />
              : <span style={{ width: 52, height: 52, borderRadius: 999, background: "#EAF1FB", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--accent)" }}>{sym.slice(0, 1)}</span>}
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{sym}{net.key === "robinhood" && <CoverChip token={token.address} />}</div>
              <div className="note" style={{ marginTop: 2 }}>{t?.name && t.name !== sym ? `${t.name} · ` : ""}{net.name}{t?.launchpad ? ` · ${t.launchpad} launch` : ""}</div>
            </div>
          </div>
          <div style={{ marginTop: 18, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--serif)", fontSize: 40 }}>{priceFmt(t?.priceUsd ?? null)}</span>
            {ch !== null && <span style={{ fontFamily: "var(--mono)", color: ch >= 0 ? "#1E6B41" : "#8A2B20" }}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}% 24h</span>}
          </div>

          <div className="lbl" style={{ marginTop: 20 }}>RIGHT NOW ON STOA</div>
          {t?.quote ? (
            <div className="det" style={{ marginTop: 8 }}>
              <span>You pay</span><span>{t.quote.amountIn} {net.gas}</span>
              <span>You get</span><span>{t.quote.amountOut} {sym}</span>
              {t.quote.venues.length > 0 && <><span>Filled by</span><span>{t.quote.venues.join(" → ")}</span></>}
            </div>
          ) : <p className="note">No route for {sym} on Stoa at this moment. Try again in a minute, or open Trade to check other amounts.</p>}

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <Link className="big pri" href={buy} style={{ flex: "1 1 160px", marginTop: 0, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Buy {sym}</Link>
            <Link className="big" href={sell} style={{ flex: "1 1 160px", marginTop: 0, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", background: "#fff", border: "1px solid var(--line)", color: "var(--ink)" }}>Sell {sym}</Link>
          </div>

          <div className="lbl" style={{ marginTop: 20 }}>CONTRACT</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <code style={{ fontFamily: "var(--mono)", fontSize: 13, overflowWrap: "anywhere" }}>{token.address}</code>
            <CopyButton text={token.address} />
            <a href={`${net.explorer}/token/${token.address}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>Explorer ↗</a>
          </div>
          <div className="notice" style={{ marginTop: 16, marginBottom: 0 }}>
            Listed because it trades on {net.name}. Not reviewed by Stoa: anyone can create a token with any name, so check the contract address before you buy.
            {t?.launchpad === "Pons" && <> Curve progress, creator tax and Rug Cover: <Link href={`/launches/${token.address}`}>{sym} on Launches</Link>.</>}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="grid3" style={{ gap: 12 }}>
            {stat("LIQUIDITY", usdFmt(t?.liquidityUsd ?? null))}
            {stat("24H VOLUME", usdFmt(t?.volume24h ?? null))}
            {stat("FDV", usdFmt(t?.fdvUsd ?? null))}
          </div>
          <TokenShare chain={net.key} address={token.address} symbol={sym} />
          {others.length > 0 && (
            <div className="panel pad">
              <div className="lbl">MORE TOKENS ON {net.name.toUpperCase()}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {others.map((o) => <Link key={o.token.address} className="ghost" style={{ borderColor: "var(--line)", background: "#fff" }} href={`/tokens/${net.key}/${o.token.address}`}>{o.token.symbol}</Link>)}
                <Link className="ghost" style={{ borderColor: "var(--line)", background: "#fff" }} href="/tokens">All tokens →</Link>
              </div>
            </div>
          )}
          <p className="note" style={{ marginTop: 0 }}>Price, liquidity, volume and FDV from DexScreener. The route on Stoa is read live from the router. Refreshed every minute.</p>
        </div>
      </div>
    </section>
  );
}
