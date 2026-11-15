import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/ui";
import { NETS } from "@/lib/networks";
import { listedTokens } from "@/lib/tokenInfo";

const description = "Every token Stoa lists on Robinhood Chain and Elysium, each with its live price and Stoa's best route for it.";
export const metadata: Metadata = {
  alternates: { canonical: "/tokens" },
  title: "Tokens",
  description,
  openGraph: { title: "Tokens · Stoa", description, type: "website", siteName: "Stoa" },
  twitter: { card: "summary_large_image", site: "@StoaDex", title: "Tokens · Stoa", description },
};

export default function TokensPage() {
  const all = listedTokens();
  const nets = [...NETS].filter((n) => n.deployed).sort((a, b) => (a.key === "robinhood" ? -1 : b.key === "robinhood" ? 1 : 0));
  return (
    <section className="page">
      <PageHead eyebrow="TOKENS" title="Tokens on Stoa" action={<Link className="cta" href="/trade">Trade</Link>}>
        Every token Stoa lists, by network. Each page shows the live price and the best route on Stoa right now. Listed tokens are not reviewed by Stoa: check the contract address before you buy.
      </PageHead>
      {nets.map((n) => {
        const ts = all.filter((x) => x.net.key === n.key);
        if (!ts.length) return null;
        return (
          <div key={n.key} className="panel pad" style={{ marginBottom: 20 }}>
            <div className="lbl">{n.name.toUpperCase()} · {ts.length} TOKENS</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginTop: 14 }}>
              {ts.map(({ token: t }) => (
                <Link key={t.address} href={`/tokens/${n.key}/${t.address}`} className="ghost" style={{ borderColor: "var(--line)", background: "#fff", minHeight: 48 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {t.logo ? <img src={t.logo} alt="" width={24} height={24} style={{ borderRadius: 999, objectFit: "cover" }} loading="lazy" />
                    : <span style={{ width: 24, height: 24, borderRadius: 999, background: "#EAF1FB", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{t.symbol.slice(0, 1)}</span>}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.symbol}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
