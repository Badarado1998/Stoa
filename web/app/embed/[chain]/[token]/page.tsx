import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE } from "@/lib/chain";
import { cleanRef } from "@/lib/swap";
import { findListed, priceFmt, readToken } from "@/lib/tokenInfo";

// /embed/<chain>/<token>?ref=<wallet>: a small buy card any website can put in an iframe. It shows the token's price and
// Stoa's best route right now; Buy opens Stoa in a new tab with the referral, so no wallet ever connects inside the frame.
// The only route Stoa lets other sites frame (see next.config.mjs).

export const metadata: Metadata = { title: "Buy on Stoa", robots: { index: false, follow: false } };

type P = { params: Promise<{ chain: string; token: string }>; searchParams: Promise<{ ref?: string }> };

export default async function Embed({ params, searchParams }: P) {
  const [{ chain, token }, sp] = await Promise.all([params, searchParams]);
  const hit = findListed(chain, token);
  if (!hit) notFound();
  const t = await readToken(chain, token).catch(() => null);
  const ref = cleanRef(sp.ref);
  const sym = hit.token.symbol;
  const buy = `${SITE}/trade?chain=${hit.net.key}&buy=${hit.token.address}${ref ? `&ref=${ref}` : ""}`;
  const ch = t?.change24h ?? null;
  const logo = hit.token.logo ? (hit.token.logo.startsWith("http") ? hit.token.logo : `${SITE}${hit.token.logo}`) : null;
  return (
    <div className="embed">
      <div className="em-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={logo} alt="" width={40} height={40} className="em-logo" /> : <span className="em-logo em-glyph">{sym.slice(0, 1)}</span>}
        <div className="em-id">
          <b>{sym}</b>
          <span>{hit.net.name}</span>
        </div>
        <div className="em-px">
          <b>{priceFmt(t?.priceUsd ?? null)}</b>
          {ch !== null && <span className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}%</span>}
        </div>
      </div>
      <div className="em-q">
        {t?.quote
          ? <>{t.quote.amountIn} {hit.net.gas} → <b>{t.quote.amountOut} {sym}</b><small>best price across every venue on {hit.net.name}{t.quote.venues.length ? `, now on ${t.quote.venues.join(" → ")}` : ""}</small></>
          : <>Best price across every venue on {hit.net.name}<small>Open Stoa to get a live quote for any amount.</small></>}
      </div>
      <a className="em-buy" href={buy} target="_blank" rel="noopener noreferrer">Buy {sym} on Stoa ↗</a>
      <div className="em-foot">
        <a href={SITE} target="_blank" rel="noopener noreferrer">Powered by <b>STOA</b></a>
        <span>2 bps fee · not financial advice</span>
      </div>
    </div>
  );
}
