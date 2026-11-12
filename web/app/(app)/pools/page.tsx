import type { Metadata } from "next";
import Link from "next/link";
import { CONTRACTS } from "@/lib/chain";
import { PageHead, Pair } from "@/components/ui";
import PoolDepth from "@/components/PoolDepth";
import RouterStats from "@/components/RouterStats";

export const metadata: Metadata = { title: "Pools" };

export default function PoolsPage() {
  const live = !!CONTRACTS.pool;
  return (
    <section className="page">
      <PageHead eyebrow="POOLS" title="Every pool is a column" action={<Link className="cta" href="/curators">Run a pool</Link>}>
        Each pool is priced by its own makers. When no maker quotes, swaps still fill on Uniswap, Aero, Ramses or Liquidity Book through the router.
      </PageHead>
      <RouterStats />
      <div className="panel" style={{ overflow: "hidden", marginBottom: 20 }}>
        <table className="tbl">
          <thead><tr><th>POOL</th><th className="hm">PRICING</th><th className="hm">FEE</th><th className="hm">PER-SWAP CAP</th><th>STATUS</th><th /></tr></thead>
          <tbody>
            <tr>
              <td><Pair /></td><td className="hm">Maker-quoted</td><td className="hm" style={{ fontFamily: "var(--mono)" }}>2 bps</td><td className="hm" style={{ fontFamily: "var(--mono)" }}>$500</td>
              <td><span className="chip live">{live ? "Deployed" : "Opening soon"}</span></td>
              <td style={{ textAlign: "right" }}><Link href="/trade" className="go" style={{ margin: 0 }}>Trade</Link></td>
            </tr>
            <tr><td colSpan={6} style={{ color: "var(--muted)", fontSize: 13.5 }}>Want your token here? Curators can apply to run a pool. <Link href="/curators">How it works</Link></td></tr>
          </tbody>
        </table>
      </div>
      <PoolDepth />
    </section>
  );
}
