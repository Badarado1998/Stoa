import { kv, kvOn } from "@/lib/kv";
import { tgOn, tgSend } from "@/lib/telegram";
import { cronAllowed, cronRefused } from "@/lib/cronAuth";

// GET /api/cron/health (Vercel cron, every 5 minutes): the same checks as the uptime workflow (home page, Trade, a live
// router quote, the stock list, the Spotlight API), told to the Telegram chats that sent /statusalerts on to the bot:
// once when something has failed two runs in a row (about 5-10 minutes), once when it is back. The GitHub uptime
// workflow still opens an issue and records /status; this is the quick phone alert. Read-only.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE = "https://stoadex.com";
const CHECKS: [string, string, (j: unknown) => boolean][] = [
  ["Home page", "/", () => true],
  ["Trade page", "/trade", () => true],
  ["Router quote 0.01 ETH → USDG", "/api/v1/quote?chain=robinhood&sellToken=native&buyToken=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168&amount=10000000000000000", (j) => Number((j as { amountOut?: string }).amountOut ?? 0) > 0],
  ["Stock tokens API", "/api/v1/stocks", (j) => ((j as { stocks?: unknown[] }).stocks?.length ?? 0) > 0],
  ["Spotlight API", "/api/v1/spotlight", (j) => Number((j as { week?: number }).week ?? 0) >= 1],
];

async function check([name, path, ok]: (typeof CHECKS)[number]): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(SITE + path, { headers: { "user-agent": "stoa-health/1" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (r.ok) {
        if (path === "/" || path === "/trade") return null;
        if (ok(await r.json())) return null;
      }
      if (i === 1) return `${name}: HTTP ${r.status}`;
    } catch (e) {
      if (i === 1) return `${name}: ${(e as Error).name === "TimeoutError" ? "no answer in 20 s" : "request failed"}`;
    }
    await new Promise((res) => setTimeout(res, 5_000));
  }
  return null;
}

export async function GET(req: Request) {
  if (!cronAllowed(req)) return cronRefused();
  if (!tgOn || !kvOn) return Response.json({ ok: false, why: "not switched on" });
  if ((await kv("SET", "health:lock", 1, "NX", "EX", 240)) !== "OK") return Response.json({ ok: true, skipped: "ran recently" });
  const fails = (await Promise.all(CHECKS.map(check))).filter((x): x is string => !!x);
  const prev = Number((await kv<string>("GET", "health:fails")) ?? 0);
  const down = (await kv<string>("GET", "health:down")) === "1";
  const chats = ((await kv<string[]>("SMEMBERS", "tg:statusalerts")) ?? []).slice(0, 20);
  const now = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  let sent = 0;
  if (fails.length) {
    await kv("SET", "health:fails", prev + 1, "EX", 86400);
    if (prev + 1 >= 2 && !down) {
      await kv("SET", "health:down", 1, "EX", 7 * 86400);
      const text = `🔴 <b>Stoa check failing</b> · ${now}\n\n${fails.map((f) => `• ${f}`).join("\n")}\n\nFailing for about ${(prev + 1) * 5} minutes. I'll say here when it's back.`;
      for (const c of chats) if (await tgSend(c, text, undefined, { text: "Status page ↗", url: `${SITE}/status` })) sent++;
    }
  } else {
    await kv("DEL", "health:fails");
    if (down) {
      await kv("DEL", "health:down");
      for (const c of chats) if (await tgSend(c, `🟢 <b>Stoa is back</b> · ${now}\n\nEvery check passes again.`)) sent++;
    }
  }
  return Response.json({ ok: true, fails, down: fails.length ? prev + 1 >= 2 : false, sent });
}
