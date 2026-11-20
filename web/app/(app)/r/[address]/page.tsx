import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isAddress } from "viem";
import { PageHead } from "@/components/ui";
import RefSave from "@/components/RefSave";

// /r/<wallet>: an invite to Stoa from a referrer. Saves the referral like ?ref= and points to Trade; its card is the
// invite image people share.
type P = { params: Promise<{ address: string }> };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) return {};
  const title = "You're invited to swap on Stoa";
  const description = "Swap on Robinhood Chain with every route compared for your amount: stock tokens, launches and more, for a 2 bps fee. Swaps earn Stoa Points.";
  return { title, description, robots: { index: false, follow: true }, openGraph: { title: `${title} · Stoa`, description, siteName: "Stoa" }, twitter: { card: "summary_large_image", site: "@StoaDex", title: `${title} · Stoa`, description } };
}

export default async function Invite({ params }: P) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) notFound();
  return (
    <section className="page">
      <RefSave address={address} />
      <PageHead eyebrow={`INVITED BY ${short(address)}`} title="Swap on Stoa">
        Stoa compares every venue it routes on Robinhood Chain for your exact amount and fills where you get the most, for a 2 bps fee. Your wallet signs every swap; Stoa never holds your funds.
      </PageHead>
      <div className="grid3 sgrid" style={{ marginBottom: 16 }}>
        <div className="panel pad"><div className="lbl">STOCK TOKENS, 24/7</div><p style={{ marginBottom: 0 }}>Robinhood Stock Tokens trade on-chain at any hour, with Robinhood&apos;s price shown next to the on-chain one.</p></div>
        <div className="panel pad"><div className="lbl">CHECKED BEFORE YOU SWAP</div><p style={{ marginBottom: 0 }}>A simulated buy and sell shows a token&apos;s tax and whether it can be sold.</p></div>
        <div className="panel pad"><div className="lbl">POINTS</div><p style={{ marginBottom: 0 }}>Swaps earn Stoa Points in season 1. <Link href="/points">How points work</Link></p></div>
      </div>
      <div className="panel pad" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="cta" href={`/trade?chain=robinhood&ref=${address}`}>Start swapping</Link>
        <Link className="ghost" href="/bridge">Bridge funds in first</Link>
      </div>
      <p className="note" style={{ marginTop: 10 }}>Your friend earns 10% of Stoa&apos;s fee on your swaps; you pay nothing extra. Not financial advice.</p>
    </section>
  );
}
