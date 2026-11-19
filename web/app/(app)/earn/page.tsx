import type { Metadata } from "next";
import Link from "next/link";
import { PageHead, Pair } from "@/components/ui";

export const metadata: Metadata = {
  title: "Earn",
  description: "Stoa pool vaults: deposit and hold shares that grow with the fees traders pay. Vaults open only after the pool contracts are audited.",
  alternates: { canonical: "/earn" },
};

export default function EarnPage() {
  return (
    <section className="page">
      <PageHead eyebrow="II · EARN" title="Own a piece of the pool">Deposit into a pool vault and hold shares that grow with every fee traders pay.</PageHead>
      <div className="grid2">
        <div className="panel pad">
          <div className="rowx" style={{ marginBottom: 12 }}><Pair /><span className="chip">After audit</span></div>
          <div className="box" style={{ opacity: 0.6 }}>
            <div className="row"><span className="lbl">DEPOSIT</span><span className="lbl">BALANCE —</span></div>
            <div className="row"><span style={{ fontFamily: "var(--num)", fontSize: 28, color: "#AAB2BE" }}>0.00</span><span className="tok"><img className="ti img" src="/tokens/usdc.svg" alt="" width={26} height={26} />USDC</span></div>
          </div>
          <div className="det"><span>You receive</span><span>Vault shares (ERC-4626)</span><span>Fees earned</span><span>Added to share price</span><span>Withdraw</span><span>Any time</span></div>
          <button className="big" type="button" disabled>Vaults open after the audit</button>
          <p className="note">Vaults hold other people&apos;s funds, so they open only after the pool contracts are audited. Until then, pool inventory comes from each pool&apos;s curator.</p>
        </div>
        <div className="panel pad">
          <div className="lbl">HOW EARNING WILL WORK</div>
          <ul className="list"><li>Shares are standard ERC-4626 tokens <b>Composable</b></li><li>The maker&apos;s spread flows back into the vault <b>Auto-compounding</b></li><li>Makers price the pool, you supply the depth <b>No active work</b></li></ul>
          <Link className="go" href="/docs/provide-liquidity">Read about the risks</Link>
        </div>
      </div>
    </section>
  );
}
