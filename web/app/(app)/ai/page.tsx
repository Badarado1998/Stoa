import type { Metadata } from "next";
import Link from "next/link";
import AiChat from "@/components/AiChat";

const description = "Stoa AI, an AI assistant for Robinhood Chain (early beta): ask in plain words to check a token, quote and prepare swaps, turn a strategy into a limit order, scan your wallet for rug signs and compare stock tokens with Robinhood. Also on Telegram. You sign everything in your own wallet.";
export const metadata: Metadata = {
  title: "Stoa AI: an AI assistant for Robinhood Chain",
  description,
  alternates: { canonical: "/ai" },
  openGraph: { title: "Stoa AI · ask Robinhood Chain anything", description, type: "website", siteName: "Stoa" },
  twitter: { card: "summary_large_image", site: "@StoaDex", title: "Stoa AI · ask Robinhood Chain anything", description },
};

const CAN: [string, string][] = [
  ["Check any token", "\"Is this token safe?\" runs Stoa's safety check (a test buy and sell through the live router, taxes, the creator's share) and explains it."],
  ["Quote and swap", "\"Swap 0.01 ETH to USDG\": it compares every venue Stoa routes and prepares the swap as a card your wallet signs."],
  ["Strategies you type", "\"Buy NVDA with 50 USDG if it drops 5%\" becomes a limit order you sign; Stoa's keeper fills it at that price."],
  ["Rug scan and alerts", "\"Scan my tokens for rug signs\": failing sells, the creator sending out supply, crashes, thin liquidity. Alerts on Telegram."],
  ["Stock tokens", "\"How far is NVDA from Robinhood's price?\": on-chain prices next to Robinhood's own."],
  ["Spotlight, Pay, watchlist", "Lock $STOA and vote, make Stoa Pay links, keep a watchlist, ask about anything in the docs."],
];
const FAQ: [string, string][] = [
  ["Does it hold my funds or keys?", "No. It reads and builds; every swap, order and vote is a card your own wallet signs. It never asks for a seed phrase or private key."],
  ["Is it financial advice?", "No. It explains data and how things work, and never tells you what to buy or sell."],
  ["What does it cost?", "10 free messages a day. More: 50 messages for 1 USDG, or the same in ETH or $STOA (paid $STOA is burned)."],
  ["Is it on Telegram?", "Yes: @StoaDexAIbot answers in private chats and groups, with price alerts, rug alerts and a market report for groups."],
];

export default function AiPage() {
  return (
    <section className="page" style={{ paddingTop: 12 }}>
      <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Stoa AI: an AI assistant for Robinhood Chain</h1>
      <AiChat />
      <div style={{ maxWidth: 720, marginTop: 28 }}>
        <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>What Stoa AI does</h2>
        <p className="note" style={{ marginTop: 0 }}>An AI assistant for Robinhood Chain, in early beta. Ask in any language.</p>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {CAN.map(([t, d]) => <div key={t} className="panel pad"><b>{t}</b><p className="note" style={{ margin: "6px 0 0" }}>{d}</p></div>)}
        </div>
        <div className="panel pad" style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div><b>Also on Telegram and on your site</b><p className="note" style={{ margin: "4px 0 0" }}>The bot for chats and groups; a one-line widget for token projects.</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="cta" href="https://t.me/StoaDexAIbot" target="_blank" rel="noopener noreferrer">Open @StoaDexAIbot</a>
            <Link className="ghost btn" href="/projects">For projects</Link>
          </div>
        </div>
        <h2 style={{ fontSize: 22, margin: "24px 0 8px" }}>Questions</h2>
        {FAQ.map(([q, a]) => <details key={q} className="panel pad" style={{ marginBottom: 8 }}><summary style={{ fontWeight: 600, cursor: "pointer" }}>{q}</summary><p className="note" style={{ margin: "8px 0 0" }}>{a}</p></details>)}
        <p className="note">More in the docs: <Link href="/docs/ask-stoa">Stoa AI</Link> · <Link href="/docs/stoa-ai-for-projects">Stoa AI for projects</Link>.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      }) }} />
    </section>
  );
}
