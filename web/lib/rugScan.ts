import "server-only";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbi, parseAbiItem, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { NATIVE } from "./tokens";
import { srv } from "./serverRpc";
import { readSafety } from "./safety";
import { walletSnapshot } from "./aiBrief";

/** Rug scan: the signs that a token in a wallet is being pulled, read now. For each token other than ETH, WETH, USDG and
 *  the Robinhood stock tokens: Stoa's safety verdict, how far the price fell in the last hour and day, how much
 *  liquidity is left (DexScreener), and for a Pons launch how much of the supply its creator wallet sent out in the last
 *  6 hours. Read-only. Used by Stoa AI's rug_scan tool and the Telegram alerts (app/api/cron/rugwatch). */

export type RugFlag = { level: "high" | "watch"; code: string; text: string };
export type RugToken = { symbol: string; address: Address; usd: number | null; liquidityUsd: number | null; ch1: number | null; ch24: number | null; verdict: string | null; flags: RugFlag[] };

const lc = (s: string) => s.toLowerCase();
const CORE = new Set([NATIVE, ROBINHOOD.wrapped, ROBINHOOD.stable].map(lc));
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;
const factoryAbi = parseAbi(["function getLaunchedToken(address) view returns (address token, address curve, address creator)"]);
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const client = () => createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc), { timeout: 15_000 }) });
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);

type Mkt = { usd: number | null; liq: number | null; ch1: number | null; ch24: number | null };
export async function marketOf(addrs: string[]): Promise<Record<string, Mkt>> {
  const out: Record<string, Mkt> = {};
  for (let i = 0; i < addrs.length; i += 30) {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/${ROBINHOOD.dexscreener}/${addrs.slice(i, i + 30).join(",")}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) continue;
    const pairs = (await r.json().catch(() => [])) as { baseToken: { address: string }; priceUsd?: string; priceChange?: { h1?: number; h24?: number }; liquidity?: { usd?: number } }[];
    for (const p of pairs) {
      const a = lc(p.baseToken.address), liq = p.liquidity?.usd ?? 0;
      if ((out[a]?.liq ?? -1) >= liq) continue;
      out[a] = { usd: Number(p.priceUsd) || null, liq, ch1: p.priceChange?.h1 ?? null, ch24: p.priceChange?.h24 ?? null };
    }
  }
  return out;
}

/** the wallet's tokens: every ERC-20 Blockscout knows of, else Stoa's token lists */
async function holdingsOf(wallet: Address): Promise<{ address: Address; symbol: string; amount: number }[]> {
  try {
    const r = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${wallet}/token-balances`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (r.ok) {
      const j = (await r.json()) as { token?: { address?: string; address_hash?: string; symbol?: string; decimals?: string; type?: string }; value?: string }[];
      const list = j.filter((x) => x.token?.type === "ERC-20" && BigInt(x.value ?? "0") > 0n).map((x) => ({
        address: getAddress(x.token!.address_hash ?? x.token!.address!), symbol: String(x.token!.symbol ?? "token").replace(/[^\w.$-]/g, "").slice(0, 12) || "token",
        amount: Number(formatUnits(BigInt(x.value!), Number(x.token!.decimals ?? 18))),
      }));
      if (Array.isArray(j)) return list;
    }
  } catch { /* fall back */ }
  const s = await walletSnapshot(wallet);
  return s.holdings.filter((h) => h.address !== NATIVE).map((h) => ({ address: h.address, symbol: h.symbol, amount: Number(h.amount.replace(/,/g, "")) }));
}

/** blocks in the last `hours`, from the chain's own clock */
async function blocksBack(c: ReturnType<typeof client>, hours: number): Promise<{ from: bigint; to: bigint }> {
  const to = await c.getBlockNumber();
  const step = 100_000n;
  const [a, b] = await Promise.all([c.getBlock({ blockNumber: to }), c.getBlock({ blockNumber: to > step ? to - step : 0n })]);
  const perSec = Number(step) / Math.max(1, Number(a.timestamp - b.timestamp));
  const n = BigInt(Math.ceil(perSec * hours * 3600));
  return { from: to > n ? to - n : 0n, to };
}

/** % of supply a Pons launch's creator wallet sent out in the window, or null when it is not a Pons launch */
async function creatorOut(c: ReturnType<typeof client>, token: Address, win: { from: bigint; to: bigint }): Promise<number | null> {
  const rec = await c.readContract({ address: PONS_FACTORY, abi: factoryAbi, functionName: "getLaunchedToken", args: [token] }).catch(() => null);
  if (!rec || lc(rec[0]) !== lc(token)) return null;
  const [logs, supply] = await Promise.all([
    c.getLogs({ address: token, event: transfer, args: { from: rec[2] }, fromBlock: win.from, toBlock: win.to }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  if (!supply) return null;
  const sent = logs.reduce((s, l) => s + (l.args.value ?? 0n), 0n);
  return Number((sent * 1_000_000n) / supply) / 10_000;
}

export async function scanToken(token: Address, symbol: string, usd: number | null, m: Mkt | undefined, win: { from: bigint; to: bigint } | null): Promise<RugToken> {
  const c = client();
  const [safety, out] = await Promise.all([
    within(readSafety(ROBINHOOD, token), 12_000),
    win ? within(creatorOut(c, token, win), 10_000) : Promise.resolve(null),
  ]);
  const flags: RugFlag[] = [];
  if (safety?.verdict === "danger") flags.push({ level: "high", code: "danger", text: `Safety check: danger. ${safety.notes[0] ?? ""}`.trim() });
  if (safety?.test && !safety.test.sellOk && safety.test.why) flags.push({ level: "high", code: "nosell", text: "A test sell failed right now." });
  if (out !== null && out >= 1) flags.push({ level: out >= 5 ? "high" : "watch", code: "creator", text: `The creator's wallet sent out ${out.toFixed(1)}% of supply in the last 6 hours.` });
  if (m?.ch1 != null && m.ch1 <= -30) flags.push({ level: "high", code: "dump1h", text: `Price fell ${Math.abs(m.ch1).toFixed(0)}% in the last hour.` });
  else if (m?.ch24 != null && m.ch24 <= -50) flags.push({ level: "watch", code: "dump24h", text: `Price fell ${Math.abs(m.ch24).toFixed(0)}% in 24 hours.` });
  if (m?.liq != null && m.liq < 2000) flags.push({ level: m.liq < 300 ? "high" : "watch", code: "liq", text: `Only about $${Math.round(m.liq).toLocaleString("en-US")} of liquidity: selling could move the price a lot.` });
  if (safety?.creatorPct != null && safety.creatorPct >= 20) flags.push({ level: "watch", code: "creatorbag", text: `The creator still holds ${safety.creatorPct.toFixed(0)}% of supply.` });
  return { symbol: safety?.symbol ?? symbol, address: token, usd, liquidityUsd: m?.liq ?? null, ch1: m?.ch1 ?? null, ch24: m?.ch24 ?? null, verdict: safety?.verdict ?? null, flags };
}

export async function rugScan(wallet: string): Promise<{ wallet: Address; scanned: number; tokens: RugToken[]; checkedAt: number }> {
  const who = getAddress(wallet);
  const stocks = new Set(await import("./stocks").then((s) => s.stockTokens()).then((x) => x.stocks.map((s) => lc(s.address))).catch(() => [] as string[]));
  const held = (await holdingsOf(who)).filter((h) => !CORE.has(lc(h.address)) && !stocks.has(lc(h.address)));
  const mkt = await marketOf(held.map((h) => h.address));
  const ranked = held.map((h) => ({ ...h, usd: mkt[lc(h.address)]?.usd != null ? h.amount * mkt[lc(h.address)].usd! : null }))
    .filter((h) => h.usd === null || h.usd >= 1).sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0)).slice(0, 8);
  const win = await within(blocksBack(client(), 6), 8000);
  const tokens = await Promise.all(ranked.map((h) => scanToken(h.address, h.symbol, h.usd, mkt[lc(h.address)], win)));
  tokens.sort((x, y) => y.flags.filter((f) => f.level === "high").length - x.flags.filter((f) => f.level === "high").length || y.flags.length - x.flags.length);
  return { wallet: who, scanned: tokens.length, tokens, checkedAt: Math.floor(Date.now() / 1000) };
}
