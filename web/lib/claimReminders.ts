import "server-only";
import { kv } from "./kv";
import { tgSend } from "./telegram";
import { epochAt } from "./spotlight";
import { epochSettled, readEarned } from "./spotlightEarned";

/** /mywallet: a private chat links one wallet; once a Spotlight week is settled, the bot says how much ETH that wallet
 *  can claim from it (once per week). Storage: tg:mywallet = hash chat -> wallet. Only chats that asked. */
export async function claimReminders(): Promise<number> {
  const ep = epochAt(Math.floor(Date.now() / 1000));
  if (ep < 1 || !(await epochSettled(ep - 1).catch(() => false))) return 0; // wait for the weekly settlement
  const map = (await kv<string[]>("HGETALL", "tg:mywallet")) ?? [];
  let sent = 0;
  for (let i = 0; i + 1 < map.length && i < 2000; i += 2) {
    const chat = map[i], wallet = map[i + 1];
    if ((await kv("SET", `tg:claimed-told:${ep}:${chat}`, 1, "NX", "EX", 21 * 86400)) !== "OK") continue;
    const e = await readEarned(wallet).catch(() => null);
    if (!e) { await kv("DEL", `tg:claimed-told:${ep}:${chat}`); continue; } // the week may not be settled yet, or the chain slow
    const rows = e.rows.filter((r) => r.week === ep && !r.claimed);
    const eth = rows.reduce((a, r) => a + r.eth, 0);
    if (eth <= 0) continue;
    const text = `🔦 <b>ETH to claim</b>\n\nSpotlight week ${ep} paid <code>${wallet.slice(0, 6)}…${wallet.slice(-4)}</code> about <b>${eth.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH</b> (${rows.map((r) => r.symbol).join(", ")}). Claim it on the Spotlight page; claims never expire.`;
    if (await tgSend(chat, text, undefined, { text: "Claim on Stoa ↗", url: "https://stoadex.com/spotlight" })) sent++;
  }
  return sent;
}
