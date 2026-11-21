import { kv } from "@/lib/kv";
import { cronAllowed, cronRefused } from "@/lib/cronAuth";
import { allSubs, pushOn, pushTo, saveSub, type PushAlert } from "@/lib/push";
import { BID_WINDOW, SPOT_START, WEEK, epochAt, epochStart } from "@/lib/spotlight";
import { readEarned } from "@/lib/spotlightEarned";
import { marketOf } from "@/lib/rugScan";

// GET /api/cron/push (Vercel cron, every 10 minutes): web push to the devices that turned on notifications.
// 1. Spotlight moments, once each: 12 hours before week 1, a week opening, 6 hours before votes close.
// 2. ETH to claim: once a week is settled, each device with a wallet that earned in it.
// 3. Price alerts, checked here too so they arrive while Stoa is closed (the open site checks them every minute; the
//    same tag means a phone shows one notification, not two).
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const H = 3600;
const when = (t: number) => new Date(t * 1000).toUTCString().slice(0, 22) + " UTC";
const usd = (v: number) => (v >= 1 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${v.toPrecision(3)}`);
const crossed = (a: PushAlert, v: number) => (a.kind === "gap" ? (a.dir === "above" ? v >= a.price : v <= -a.price) : a.dir === "above" ? v >= a.price : v <= a.price);

export async function GET(req: Request) {
  if (!cronAllowed(req)) return cronRefused();
  if (!pushOn) return Response.json({ ok: false, why: "push keys are not set" });
  if ((await kv("SET", "push:lock", 1, "NX", "EX", 300)) !== "OK") return Response.json({ ok: true, skipped: "ran recently" });
  const subs = await allSubs();
  if (!subs.length) return Response.json({ ok: true, devices: 0 });
  const now = Math.floor(Date.now() / 1000), ep = epochAt(now);
  let moments = 0, claims = 0, alerts = 0;

  // 1. Spotlight moments
  let m: { key: string; title: string; body: string } | null = null;
  if (ep < 0 && SPOT_START - now <= 12 * H) m = { key: "pre", title: "Spotlight opens soon", body: `Week 1 opens ${when(SPOT_START)}. Lock $STOA now so it can vote.` };
  else if (ep >= 0) {
    const start = epochStart(ep);
    if (now - start < 2 * H) m = { key: `open:${ep}`, title: `Spotlight week ${ep + 1} is open`, body: `Projects bid ETH until ${when(start + BID_WINDOW)}. Lock $STOA and vote for a share of the winning bids.` };
    else if (start + WEEK - now > 0 && start + WEEK - now <= 6 * H) m = { key: `votes:${ep}`, title: "Spotlight votes close in about 6 hours", body: `Votes close ${when(start + WEEK)}. Check your votes before then.` };
  }
  if (m && (await kv("SET", `push:spot:${m.key}`, 1, "NX", "EX", 14 * 86400)) === "OK") {
    for (const [id, s] of subs) if (await pushTo(id, s, { title: m.title, body: m.body, url: "/spotlight", tag: `spot-${m.key}` })) moments++;
  }

  // 2. ETH to claim from the week that just closed (epoch ep-1 is week ep)
  if (ep >= 1) {
    for (const [id, s] of subs) {
      if (!s.wallet || (await kv("SET", `push:claim:${ep}:${id}`, 1, "NX", "EX", 21 * 86400)) !== "OK") continue;
      const e = await readEarned(s.wallet).catch(() => null);
      if (!e) { await kv("DEL", `push:claim:${ep}:${id}`); continue; } // try again next run
      const eth = e.rows.filter((r) => r.week === ep && !r.claimed).reduce((a, r) => a + r.eth, 0);
      if (eth > 0 && (await pushTo(id, s, { title: "ETH to claim on Stoa", body: `Spotlight week ${ep} paid you about ${eth.toLocaleString("en-US", { maximumFractionDigits: 5 })} ETH. Claim it on the Spotlight page.`, url: "/spotlight", tag: `claim-${ep}` }))) claims++;
    }
  }

  // 3. price alerts (Robinhood Chain), each once
  const pending = subs.flatMap(([id, s]) => s.alerts.filter((a) => !a.fired && a.chain === "robinhood").map((a) => [id, s, a] as const));
  if (pending.length) {
    const priceAddrs = [...new Set(pending.filter(([, , a]) => a.kind !== "gap").map(([, , a]) => a.address))];
    const [prices, gaps] = await Promise.all([
      priceAddrs.length ? marketOf(priceAddrs).catch(() => ({} as Awaited<ReturnType<typeof marketOf>>)) : Promise.resolve({} as Awaited<ReturnType<typeof marketOf>>),
      pending.some(([, , a]) => a.kind === "gap")
        ? fetch("https://stoadex.com/api/v1/stocks", { signal: AbortSignal.timeout(15_000) }).then((r) => r.json()).then((j: { stocks: { address: string; referencePriceUsd: number | null; halted: boolean; onChain: { priceUsd: number } | null }[] }) => {
            const g: Record<string, number> = {};
            for (const x of j.stocks) if (x.referencePriceUsd && x.onChain?.priceUsd && !x.halted) g[x.address.toLowerCase()] = ((x.onChain.priceUsd - x.referencePriceUsd) / x.referencePriceUsd) * 100;
            return g;
          }).catch(() => ({} as Record<string, number>))
        : Promise.resolve({} as Record<string, number>),
    ]);
    const dirty = new Map<string, typeof subs[number][1]>();
    for (const [id, s, a] of pending) {
      const v = a.kind === "gap" ? gaps[a.address] : prices[a.address]?.usd;
      if (v === undefined || v === null || (a.kind !== "gap" && !v) || !crossed(a, v)) continue;
      a.fired = true; dirty.set(id, s);
      const body = a.kind === "gap" ? `${a.symbol} on-chain is now ${v >= 0 ? "+" : ""}${v.toFixed(2)}% vs Robinhood (your alert: ${a.price}% ${a.dir === "below" ? "cheaper" : "dearer"}).` : `${a.symbol} is ${a.dir} ${usd(a.price)}: now ${usd(v)}.`;
      if (await pushTo(id, s, { title: "Stoa price alert", body, url: `/trade?chain=robinhood&buy=${a.address}`, tag: a.id })) alerts++;
    }
    for (const s of dirty.values()) await saveSub(s);
  }
  return Response.json({ ok: true, devices: subs.length, moments, claims, alerts });
}
