"use client";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { RouterStats } from "@/lib/routerStats";
import { NETS } from "@/lib/networks";
import { Sk } from "./ui";

const usd = (v: number) => (v >= 1000 ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "$" + v.toFixed(2));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// a referrer earns 10% of the 2 bps protocol fee, so about 0.002% of the volume it referred
const EARN = 0.0002 * 0.1;

/** Referrers ranked by the volume of the swaps they referred, from the routers' events (/api/stats, cached 5 min). */
export default function ReferralBoard() {
  const { address } = useAccount();
  const q = useQuery({
    queryKey: ["router-stats"],
    queryFn: async () => {
      const r = await fetch("/api/stats");
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as RouterStats;
    },
    staleTime: 240_000, retry: 2,
  });
  const list = q.data?.referrers ?? [];
  const me = address?.toLowerCase();
  const explorer = (chain: string) => NETS.find((n) => n.key === chain)?.explorer;
  return (
    <div className="panel" style={{ overflow: "hidden", marginTop: 20 }}>
      <div className="pad" style={{ paddingBottom: 0 }}>
        <div className="rowx"><div className="lbl">TOP REFERRERS</div><span className="chip">All time · both chains</span></div>
        <p className="note" style={{ marginTop: 6 }}>Ranked by the volume of the swaps each link brought in, read from the routers&apos; on-chain events. Earned is an estimate: 10% of the 2 bps fee.</p>
      </div>
      {q.isLoading ? <div className="pad"><Sk w={240} /></div> : list.length === 0 ? (
        <p className="pad" style={{ margin: 0 }}>No referred swaps yet. Share your link and be the first on the board.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>#</th><th>REFERRER</th><th style={{ textAlign: "right" }}>SWAPS</th><th style={{ textAlign: "right" }}>VOLUME</th><th className="hm" style={{ textAlign: "right" }}>7 DAYS</th><th style={{ textAlign: "right" }}>EARNED</th></tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.address} style={r.address === me ? { background: "rgba(47,111,214,.07)" } : undefined}>
                <td style={{ fontFamily: "var(--num)" }}>{i + 1}</td>
                <td><a href={`${explorer(r.chains[0])}/address/${r.address}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "var(--mono)" }}>{short(r.address)}</a>{r.address === me && <b> · you</b>}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{r.swaps.toLocaleString("en-US")}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{usd(r.usd)}</td>
                <td className="hm" style={{ textAlign: "right", fontFamily: "var(--num)" }}>{usd(r.usd7d)}</td>
                <td style={{ textAlign: "right", fontFamily: "var(--num)" }}>{r.usd * EARN < 0.01 ? "< $0.01" : usd(r.usd * EARN)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
