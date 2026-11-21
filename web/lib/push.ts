import "server-only";
import { createHash } from "node:crypto";
import webpush from "web-push";
import { kv, kvOn } from "./kv";

/** Web push for the installed app and browsers: Spotlight moments, ETH ready to claim, and price alerts while Stoa is
 *  closed. Only for devices that turned it on (a "Notify me" button); nothing is sent to anyone else.
 *  Keys: NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel (made once in the browser, see /admin).
 *  Storage: push:s:<id> = the subscription with its wallet and alerts (90 days, renewed on every visit), push:all = ids. */

const PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const PRIV = process.env.VAPID_PRIVATE_KEY || "";
export const pushOn = !!(PUB && PRIV && kvOn);
if (pushOn) webpush.setVapidDetails("https://stoadex.com", PUB, PRIV);

export type PushAlert = { id: string; chain: string; address: string; symbol: string; dir: "above" | "below"; price: number; kind?: "price" | "gap"; fired?: boolean };
export type PushSub = { sub: { endpoint: string; keys: { p256dh: string; auth: string } }; wallet?: string; alerts: PushAlert[]; at: number };

const TTL = 90 * 86400;
export const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 24);

export async function saveSub(s: PushSub) {
  const id = subId(s.sub.endpoint);
  await kv("SET", `push:s:${id}`, JSON.stringify(s), "EX", TTL);
  await kv("SADD", "push:all", id);
  return id;
}

export async function dropSub(id: string) {
  await kv("DEL", `push:s:${id}`);
  await kv("SREM", "push:all", id);
}

export async function allSubs(max = 3000): Promise<[string, PushSub][]> {
  const ids = ((await kv<string[]>("SMEMBERS", "push:all")) ?? []).slice(0, max);
  const out: [string, PushSub][] = [];
  for (const id of ids) {
    const raw = await kv<string>("GET", `push:s:${id}`);
    if (!raw) { await kv("SREM", "push:all", id); continue; } // expired
    try { out.push([id, JSON.parse(raw) as PushSub]); } catch { await dropSub(id); }
  }
  return out;
}

/** one notification to one device; a device that unsubscribed (404/410) is forgotten */
export async function pushTo(id: string, s: PushSub, n: { title: string; body: string; url: string; tag?: string }): Promise<boolean> {
  if (!pushOn) return false;
  try {
    await webpush.sendNotification(s.sub, JSON.stringify(n), { TTL: 6 * 3600, urgency: "normal" });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) await dropSub(id);
    return false;
  }
}

export async function pushAll(n: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  if (!pushOn) return 0;
  let sent = 0;
  for (const [id, s] of await allSubs()) if (await pushTo(id, s, n)) sent++;
  return sent;
}
