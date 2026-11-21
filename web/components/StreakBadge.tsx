"use client";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { shareOrCopy } from "@/lib/share";

/** The connected wallet's weekly swap streak on Stoa, with a share button. A badge only: it earns no points. */
type Streak = { current: number; best: number; weeks: number; thisWeek: boolean; swaps: number };

export default function StreakBadge() {
  const { address } = useAccount();
  const q = useQuery({
    queryKey: ["streak", address],
    enabled: !!address,
    staleTime: 300_000,
    queryFn: async () => { const r = await fetch(`/api/streak?address=${address}`); if (!r.ok) throw new Error("streak"); return (await r.json()) as Streak; },
  });
  const s = q.data;
  if (!address || !s || !s.swaps) return null;
  const flame = s.current >= 8 ? "🔥🔥🔥" : s.current >= 4 ? "🔥🔥" : s.current >= 2 ? "🔥" : "✨";
  const text = s.current >= 2 ? `${s.current} weeks in a row swapping on @StoaDEX ${flame} Every venue on Robinhood Chain, compared on every swap.` : "";
  const post = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://stoadex.com")}`;
  return (
    <div className="panel pad" style={{ gridColumn: "1 / -1" }}>
      <div className="rowx" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="lbl">WEEKLY STREAK</div>
          <div style={{ fontFamily: "var(--num)", fontSize: 24, marginTop: 6 }}>{flame} {s.current} week{s.current === 1 ? "" : "s"}</div>
          <p className="note" style={{ marginTop: 6 }}>
            {s.current === 0 ? "Swap once this week to start a streak." : s.thisWeek ? "This week counts: swap again next week to keep it going." : "Swap before Monday 00:00 UTC to keep it going."}
            {s.best > s.current ? ` Best: ${s.best} weeks.` : ""} A badge only: it earns no points.
          </p>
        </div>
        {s.current >= 2 && (
          <div style={{ display: "flex", gap: 8 }}>
            <a className="ghost" href={post} target="_blank" rel="noopener noreferrer">Share on X</a>
            <button type="button" className="ghost" onClick={() => void shareOrCopy("https://stoadex.com", text)}>Share</button>
          </div>
        )}
      </div>
    </div>
  );
}
