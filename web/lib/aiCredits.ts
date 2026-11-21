import "server-only";
import { randomBytes } from "node:crypto";
import { createPublicClient, formatUnits, getAddress, http, type Address, type Hash, type Hex } from "viem";
import { apiQuote } from "./api";
import { ROBINHOOD } from "./networks";
import { NATIVE } from "./tokens";
import { srv } from "./serverRpc";
import { kv, kvOn } from "./kv";

/** Stoa AI's free messages and paid credits, kept in Upstash (lib/kv.ts).
 *  Free: FREE_PER_DAY a day per visitor (IP), and a daily cap for the whole site.
 *  Credits: a pack of PACK_MSGS messages costs PACK_USD, paid on Robinhood Chain from the connected wallet in USDG or
 *  ETH (to Stoa's Safe), or in $STOA, which is sent to the burn address. The server checks the payment on-chain
 *  (from that wallet, to that address, within a day, used once) and credits the wallet. Credits never expire. */

export const FREE_PER_DAY = 10;
export const PACK_MSGS = Number(process.env.AI_PACK_MSGS || 50);
export const PACK_USD = Number(process.env.AI_PACK_USD || 1);
const DAILY_CAP = Number(process.env.AI_DAILY_CAP || 3000);
export const SAFE = ROBINHOOD.contracts.safe as Address;
export const BURN = "0x000000000000000000000000000000000000dEaD" as Address;
export const STOA = "0x13E6993417616De724F2b337D65063f229e96718" as Address;
const USDG = ROBINHOOD.stable;

const day = () => new Date().toISOString().slice(0, 10);
const mem = new Map<string, number>();
let memDay = day();

/** counts one use of `key` today; returns today's count (in memory when storage is off) */
export async function countToday(key: string): Promise<number> {
  const k = `ai:q:${day()}:${key}`;
  if (kvOn) {
    const n = await kv<number>("INCR", k);
    if (n === 1) void kv("EXPIRE", k, 172_800);
    if (n !== null) return n;
  }
  if (memDay !== day()) { mem.clear(); memDay = day(); }
  const n = (mem.get(k) ?? 0) + 1; mem.set(k, n);
  return n;
}

export const creditsOf = async (wallet: Address) => Number((await kv<string>("GET", `ai:cr:${wallet.toLowerCase()}`)) ?? 0) || 0;

/** Spending credits needs proof that the browser holds the wallet: a signed message, once per device, gives a session
 *  (30 days). Without it anyone could name someone else's wallet and use up its credits. */
const sessionMessage = (wallet: Address, nonce: string) => `Stoa AI: use my credits on this device.\nWallet: ${wallet}\nNonce: ${nonce}\n\nThis signature costs nothing and moves no funds.`;

export async function newNonce(wallet: Address): Promise<{ nonce: string; message: string } | null> {
  if (!kvOn) return null;
  const nonce = randomBytes(12).toString("hex");
  await kv("SET", `ai:nonce:${nonce}`, wallet.toLowerCase(), "EX", 600);
  return { nonce, message: sessionMessage(wallet, nonce) };
}

export async function openSession(wallet: Address, nonce: string, signature: Hex): Promise<string | null> {
  if (!/^[0-9a-f]{24}$/.test(nonce)) return null;
  const owner = await kv<string>("GETDEL", `ai:nonce:${nonce}`);
  if (!owner || owner !== wallet.toLowerCase()) return null;
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc), { timeout: 15_000 }) });
  // EOAs and smart wallets (ERC-1271 / ERC-6492) alike
  const ok = await c.verifyMessage({ address: wallet, message: sessionMessage(wallet, nonce), signature }).catch(() => false);
  if (!ok) return null;
  const token = randomBytes(24).toString("hex");
  await kv("SET", `ai:sess:${token}`, wallet.toLowerCase(), "EX", 30 * 86_400);
  return token;
}

/** the wallet a session belongs to, if it is `wallet` */
export async function sessionFor(token: unknown, wallet: Address | null): Promise<Address | null> {
  if (!wallet || typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) return null;
  const w = await kv<string>("GET", `ai:sess:${token}`);
  return w && w === wallet.toLowerCase() ? wallet : null;
}

/** one message: free first, then the credits of `payer` (a wallet proven by a session). `left` is free messages left,
 *  `credits` the connected wallet's credits. */
export async function takeMessage(ip: string, wallet: Address | null, payer: Address | null = null): Promise<{ ok: true; left: number; credits: number | null } | { ok: false; why: "user" | "cap"; credits: number | null }> {
  if ((await countToday("all")) > DAILY_CAP) return { ok: false, why: "cap", credits: null };
  const n = await countToday(`ip:${ip}`);
  const credits = wallet && kvOn ? await creditsOf(wallet) : null;
  if (n <= FREE_PER_DAY) return { ok: true, left: FREE_PER_DAY - n, credits };
  if (payer && wallet && payer === wallet && credits && credits > 0) {
    const after = await kv<number>("DECR", `ai:cr:${wallet.toLowerCase()}`);
    if (after !== null && after >= 0) return { ok: true, left: 0, credits: after };
    if (after !== null) await kv("INCR", `ai:cr:${wallet.toLowerCase()}`);
  }
  return { ok: false, why: "user", credits };
}

export type PayOption = { asset: "USDG" | "ETH" | "STOA"; token: Address; to: Address; amount: string; decimals: number; display: string; burned: boolean };

/** what one pack costs in each asset right now (ETH and $STOA from Stoa's own quote, 2% over so price moves pass) */
export async function packOptions(): Promise<PayOption[]> {
  const usd = BigInt(Math.round(PACK_USD * 1e6));
  const q = async (buy: Address) => {
    const r = await apiQuote({ chain: "robinhood", sellToken: USDG, buyToken: buy === NATIVE ? "native" : buy, amount: usd.toString(), slippageBps: "50" });
    const j = (await r.json().catch(() => ({}))) as { amountOut?: string };
    return r.ok && j.amountOut ? (BigInt(j.amountOut) * 102n) / 100n : null;
  };
  const [eth, stoa] = await Promise.all([q(NATIVE), q(STOA)]);
  const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumSignificantDigits: 4 });
  const out: PayOption[] = [{ asset: "USDG", token: USDG, to: SAFE, amount: usd.toString(), decimals: 6, display: `${PACK_USD} USDG`, burned: false }];
  if (eth) out.push({ asset: "ETH", token: NATIVE, to: SAFE, amount: eth.toString(), decimals: 18, display: `${fmt(eth, 18)} ETH`, burned: false });
  if (stoa) out.push({ asset: "STOA", token: STOA, to: BURN, amount: stoa.toString(), decimals: 18, display: `${fmt(stoa, 18)} STOA`, burned: true });
  return out;
}

/** checks a payment and credits the wallet; each transaction counts once */
export async function redeem(wallet: Address, hash: Hash): Promise<{ credited: number; credits: number } | { error: string }> {
  if (!kvOn) return { error: "Credits are not switched on yet." };
  const c = createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc), { timeout: 15_000 }) });
  const [tx, rc] = await Promise.all([c.getTransaction({ hash }).catch(() => null), c.getTransactionReceipt({ hash }).catch(() => null)]);
  if (!tx || !rc) return { error: "Robinhood Chain does not show this payment yet. Try again in a few seconds." };
  if (rc.status !== "success") return { error: "This payment failed on-chain." };
  if (getAddress(tx.from) !== getAddress(wallet)) return { error: "This payment was sent from another wallet." };
  const blk = await c.getBlock({ blockNumber: rc.blockNumber });
  if (Date.now() / 1000 - Number(blk.timestamp) > 86_400) return { error: "This payment is more than a day old." };

  let usd = 0;
  const opts = await packOptions();
  const per = (o: PayOption | undefined, paid: bigint) => (o ? (Number(paid) / Number(BigInt(o.amount) * 100n / 102n)) * PACK_USD : 0);
  if (tx.to && getAddress(tx.to) === SAFE && tx.value > 0n) usd = per(opts.find((o) => o.asset === "ETH"), tx.value);
  for (const l of rc.logs) {
    if (l.topics[0] !== "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" || l.topics.length < 3) continue;
    const from = getAddress(`0x${l.topics[1]!.slice(26)}`), to = getAddress(`0x${l.topics[2]!.slice(26)}`), value = BigInt(l.data);
    if (from !== getAddress(wallet)) continue;
    if (getAddress(l.address) === getAddress(USDG) && to === SAFE) usd += Number(value) / 1e6;
    if (getAddress(l.address) === STOA && to === BURN) usd += per(opts.find((o) => o.asset === "STOA"), value);
  }
  // a little under a pack still counts: the price can move between the quote and the payment
  const packs = Math.min(100, Math.floor((usd / PACK_USD) * 1.03));
  if (packs < 1) return { error: `This payment is not a credits payment: send at least ${PACK_USD} USDG worth from your wallet to the address on the card.` };
  if ((await kv("SET", `ai:paid:${hash.toLowerCase()}`, wallet, "NX")) !== "OK") return { error: "This payment was already counted." };
  const credits = (await kv<number>("INCRBY", `ai:cr:${wallet.toLowerCase()}`, packs * PACK_MSGS)) ?? 0;
  return { credited: packs * PACK_MSGS, credits };
}
