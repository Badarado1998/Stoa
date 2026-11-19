"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtUsd, usePrices } from "@/lib/prices";
import { useStoaToken } from "@/lib/stoaToken";
import { useAccount, useBalance, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { BaseError, decodeEventLog, formatUnits, ContractFunctionRevertedError, erc20Abi as viemErc20, isAddress, maxUint256, zeroAddress, type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { NATIVE, isNative, type Token } from "@/lib/tokens";
import { ROBINHOOD, txUrlOn, type Net } from "@/lib/networks";
import { fetchGuard, routeWithoutOldV4, usesPoisoned } from "@/lib/v4guard";
import { cleanRef, describeRoute, fmt, hasRoute, minOut, parseAmount, rate, swapKind, swapParams, type Route, fmtAmt, sameForm, FORM_CHANGED, type SwapForm } from "@/lib/swap";
import { ERROR_TEXT, erc20Abi, ponsAdapterAbi, ponsCurveAbi, routedEvent, routerAbi, v4AdapterAbi, whypeAbi } from "@/lib/abi";
import { SITE } from "@/lib/chain";
import { shareOrCopy } from "@/lib/share";
import { useQuery } from "@tanstack/react-query";
import VenueCompare from "./VenueCompare";
import { findV4Pools, sameKey, type PoolKey } from "@/lib/v4";
import { useNet, useWalletModal } from "./Providers";
import { SpotlightPicks } from "./SpotlightStrip";
import { TokenIcon } from "./ui";
import PoolDepth from "./PoolDepth";
import { useCoverOffer } from "./CoverTrade";
import SafetyPanel from "./SafetyPanel";
import CmcPanel from "./CmcPanel";
import LimitPanel from "./LimitPanel";
import { WatchStar } from "./Watch";
import { session as usSession } from "@/lib/marketHours";
import { useWatch } from "@/lib/watchlist";
import { useLimitLive } from "@/lib/limit";
import { COVER, coverAbi, explainCover, useCoverLive, useOpenTokens } from "@/lib/cover";

type Quote = { out: bigint; route: Route | null; at: number; impact: number; block?: bigint } | null;
const IMPACT_WARN = 3; // %
const IMPACT_BLOCK = 15; // % — needs an explicit confirmation
const SLIPS = [0.1, 0.5, 1];
const DEADLINE_S = 120;

/** Readable message for wallet and contract errors. */
function explain(e: unknown, gas = "HYPE"): string {
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName && ERROR_TEXT[rev.data.errorName]) return ERROR_TEXT[rev.data.errorName];
    if (/User rejected|denied/i.test(e.shortMessage)) return "You rejected the request in your wallet.";
    if (/insufficient funds/i.test(e.shortMessage)) return `Not enough ${gas} to pay for gas.`;
    return e.shortMessage;
  }
  return (e as Error)?.message ?? "Something went wrong.";
}

function useReferrer(self?: string) {
  const [ref, setRef] = useState<Address | undefined>();
  useEffect(() => {
    let r: string | null = new URLSearchParams(location.search).get("ref");
    try { if (r) localStorage.setItem("stoa.ref", r); else r = localStorage.getItem("stoa.ref"); } catch { /* storage blocked */ }
    setRef(cleanRef(r, self));
  }, [self]);
  return ref;
}

export default function Trade() {
  const net = useNet();
  // a fresh swap form per network: tokens, quotes and balances never mix chains
  return <TradeOn key={net.key} net={net} />;
}

function TradeOn({ net }: { net: Net }) {
  const chain = net.chain, CONTRACTS = net.contracts, VENUE_NAMES = net.venues, deployed = net.deployed;
  const WHYPE = net.wrapped, USDC = net.stable, W = net.tokens[1].symbol, G = net.gas;
  const txUrl = (h: string) => txUrlOn(net, h);
  const { address, isConnected, chainId } = useAccount();
  const pub = usePublicClient({ chainId: chain.id });
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { open: openWallet } = useWalletModal();
  const referrer = useReferrer(address);

  const [tokens, setTokens] = useState<Token[]>(net.tokens);
  const stoa = useStoaToken(net);
  useEffect(() => {
    // $STOA goes right after the core tokens; a token with the same ticker from any other address is dropped
    if (stoa) setTokens((ts) => [...ts.slice(0, net.core), stoa, ...ts.slice(net.core).filter((t) => t.address.toLowerCase() !== stoa.address.toLowerCase() && t.symbol.toUpperCase() !== stoa.symbol.toUpperCase())]);
  }, [stoa, net.core]);
  // default: sell the native gas token (what a new wallet holds) for the network's stablecoin
  const [sell, setSell] = useState<Token>(net.tokens[0]);
  const [buy, setBuy] = useState<Token>(net.tokens[2]);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(0.5);
  const [showSet, setShowSet] = useState(false);
  const [menu, setMenu] = useState<"sell" | "buy" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [quote, setQuote] = useState<Quote>(null);
  const [quoting, setQuoting] = useState(false);
  const [noRoute, setNoRoute] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: Hash } | null>(null);
  // the last confirmed swap, offered as a shareable link that carries the trader's referral
  const [done, setDone] = useState<{ hash: Hash; net: Net["key"]; symIn: string; symOut: string; inTxt: string; outTxt: string; covered?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [unlimited, setUnlimited] = useState(false); // approve only the swap amount unless the user opts in
  const [ackToken, setAckToken] = useState(false);
  const [ackImpact, setAckImpact] = useState(false);

  const [v4Key, setV4Key] = useState<PoolKey | null>(null); // a V4 pool the router could use once registered

  const kind = swapKind(sell, buy, WHYPE);
  const amt = parseAmount(amount, sell.decimals);
  const usdOf = usePrices(net, [sell, buy]);
  const sellUsd = (usdOf(sell)?.usd ?? 0) * (Number(amount) || 0);
  const wrongChain = isConnected && chainId !== chain.id;
  // Rug Cover: a covered ETH buy goes through the cover contract, which swaps through the router for the buyer
  const cover = useCoverOffer({ net, sell, buy, amt, address, onUseEth: () => pick("sell", net.tokens[0]) });
  const coverLive = useCoverLive() && net.key === "robinhood";
  const coveredSet = useOpenTokens(coverLive);
  // Limit tab (Robinhood Chain, once StoaLimit is deployed)
  const limitLive = useLimitLive() && net.key === "robinhood";
  const [mode, setMode] = useState<"swap" | "limit">("swap");
  const limitMode = limitLive && mode === "limit";

  // balances
  const native = useBalance({ address, chainId: chain.id, query: { enabled: !!address, refetchInterval: 10_000 } });
  const sellBal = useReadContract({ address: sell.address, abi: viemErc20, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: chain.id, query: { enabled: !!address && !isNative(sell), refetchInterval: 10_000 } });
  const buyBal = useReadContract({ address: buy.address, abi: viemErc20, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: chain.id, query: { enabled: !!address && !isNative(buy), refetchInterval: 10_000 } });
  const balOf = (t: Token, r: typeof sellBal) => (isNative(t) ? native.data?.value : (r.data as bigint | undefined));
  const sBal = balOf(sell, sellBal), bBal = balOf(buy, buyBal);

  // allowance: ERC-20 sells through the router (or nothing for wrap/unwrap)
  const needsAllowance = deployed && !isNative(sell) && kind !== "unwrap";
  const allowance = useReadContract({ address: sell.address, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, CONTRACTS.router ?? zeroAddress], chainId: chain.id, query: { enabled: !!address && needsAllowance } });
  const needApprove = needsAllowance && amt !== undefined && (allowance.data as bigint | undefined ?? 0n) < amt;
  const routerPaused = useReadContract({ address: CONTRACTS.router, abi: routerAbi, functionName: "paused", chainId: chain.id, query: { enabled: deployed, refetchInterval: 15_000 } });
  const isPaused = routerPaused.data === true;
  // venues being added to the router (Robinhood Chain: Aero, Ramses): listed as live only once the router uses them
  const newLive = useReadContracts({
    contracts: net.newVenues.map((v) => ({ address: CONTRACTS.router!, abi: routerAbi, functionName: "isAdapter" as const, args: [v.address] as const, chainId: chain.id })),
    query: { enabled: deployed && net.newVenues.length > 0, refetchInterval: 60_000 },
  });
  const newVenuesLive = net.newVenues.length > 0 && net.newVenues.every((_, i) => newLive.data?.[i]?.result === true);
  const ponsLive = useReadContract({ address: CONTRACTS.router, abi: routerAbi, functionName: "isAdapter", args: [net.pons ?? zeroAddress], chainId: chain.id, query: { enabled: deployed && !!net.pons, refetchInterval: 60_000 } }).data === true;
  const risky = (sell.tone === "other" || buy.tone === "other") && kind !== "wrap" && kind !== "unwrap";
  const tokenWarning = risky && (
    <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
      This token was imported by address and is not verified by Stoa. Anyone can create a token with any name. Check the address before you trade.
      <label className="chk"><input type="checkbox" checked={ackToken} onChange={(e) => setAckToken(e.target.checked)} /> I checked the token address</label>
    </div>
  );
  // once the Pons curve adapter is live: live Pons launches join the token list (unverified, like any import)
  useEffect(() => {
    if (!ponsLive || net.key !== "robinhood") return;
    let stop = false;
    fetch("/api/pons/launches").then((r) => r.json()).then((d: { launches?: { token: Address; symbol: string; progress: number; graduated: boolean; logo: string | null }[] }) => {
      if (stop || !d.launches?.length) return;
      setTokens((ts) => {
        const have = new Set(ts.map((t) => t.address.toLowerCase()));
        const add: Token[] = d.launches!.filter((l) => !have.has(l.token.toLowerCase())).map((l) => {
          const sym = l.symbol.replace(/[^\w.$-]/g, "").slice(0, 12) || "TOKEN";
          return { symbol: sym, name: l.graduated ? "Pons · graduated" : `Pons curve · ${l.progress.toFixed(0)}%`, address: l.token, decimals: 18, glyph: sym[0] ?? "?", tone: "other" as const, logo: l.logo ?? undefined };
        });
        return add.length ? [...ts, ...add] : ts;
      });
    }).catch(() => { /* the list is a convenience; pasting an address still works */ });
    return () => { stop = true; };
  }, [ponsLive, net.key]);

  const getQuote = useCallback(async (): Promise<Quote> => {
    if (!amt) return null;
    if (kind === "wrap" || kind === "unwrap") return { out: amt, route: null, at: Date.now(), impact: 0 };
    if (!deployed || !pub) return null;
    // the router finds the best route (direct or through the wrapped native token, best venue per leg); the swap then follows it
    const small = amt / 1000n > 0n ? amt / 1000n : 1n; // price impact: compare against 1/1000 of the amount
    // pinned to one block, so the venue table under the swap box (VenueCompare) can read every venue in that same block
    // and its ✓ always matches "Filled by"; if the RPC node has not seen that block yet, quote the latest instead
    let block: bigint | undefined = await pub.getBlockNumber().catch(() => undefined);
    const q = (a: bigint, at?: bigint) => pub.simulateContract({ address: CONTRACTS.router!, abi: routerAbi, functionName: "quote", args: [sell.address, buy.address, a], ...(at ? { blockNumber: at } : {}) });
    let res;
    try { res = await Promise.all([q(amt, block), q(small, block).catch(() => null)]); }
    catch { block = undefined; res = await Promise.all([q(amt), q(small).catch(() => null)]); }
    const [{ result }, ref] = res;
    let route = result as Route;
    let r0 = ref?.result.amountOut ?? 0n;
    if (net.chain.id === ROBINHOOD.chain.id) {
      // skip Stoa's first V4 adapter on any pair where someone other than the keeper changed its pools (lib/v4guard)
      const g = await fetchGuard();
      const p = pub as unknown as PublicClient;
      if (usesPoisoned(route, sell.address, buy.address, g)) {
        const alt = await routeWithoutOldV4(p, net, sell.address, buy.address, amt);
        if (!alt) return null;
        route = alt; block = undefined; // read at the latest block
      }
      if (ref && usesPoisoned(ref.result as Route, sell.address, buy.address, g)) {
        r0 = (await routeWithoutOldV4(p, net, sell.address, buy.address, small))?.amountOut ?? 0n;
      }
    }
    if (!hasRoute(route)) return null;
    let impact = 0;
    if (r0 > 0n) impact = Math.max(0, (1 - (Number(route.amountOut) / Number(amt)) / (Number(r0) / Number(small))) * 100);
    return { out: route.amountOut, route, at: Date.now(), impact, block };
  }, [amt, kind, pub, sell, buy, net]);

  // debounce + refresh every 4s (maker quotes expire after 2 blocks)
  const seq = useRef(0);
  useEffect(() => {
    if (!amt) { setQuote(null); setNoRoute(false); return; }
    const id = ++seq.current;
    let timer: number;
    const run = async () => {
      setQuoting(true);
      try {
        const q = await getQuote();
        if (id !== seq.current) return;
        setQuote(q); setNoRoute(!q && (deployed || kind === "wrap" || kind === "unwrap"));
      } catch {
        if (id === seq.current) { setQuote(null); setNoRoute(true); }
      } finally {
        if (id === seq.current) setQuoting(false);
      }
      timer = window.setTimeout(run, 4000);
    };
    timer = window.setTimeout(run, 350);
    return () => clearTimeout(timer);
  }, [getQuote, amt, kind]);

  // No route for an imported token: look for a Uniswap V4 pool the router does not use yet, to say so (only Stoa's
  // keeper adds pools)
  const longTail = [sell, buy].find((t) => t.tone === "other" || (!!stoa && t.address === stoa.address));
  useEffect(() => {
    setV4Key(null);
    if (!noRoute || !longTail || !CONTRACTS.v4 || !pub) return;
    let stop = false;
    (async () => {
      try {
        const keys = await findV4Pools(net, longTail.address);
        const known = [
          ...((await pub.readContract({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "keysFor", args: [WHYPE, longTail.address] })) as PoolKey[]),
          ...((await pub.readContract({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "keysFor", args: [USDC, longTail.address] })) as PoolKey[]),
        ];
        for (const k of keys) {
          if (stop) return;
          if (known.some((x) => sameKey(x, k))) continue;
          const ok = await pub.readContract({ address: CONTRACTS.v4!, abi: v4AdapterAbi, functionName: "hookAllowed", args: [k.hooks] });
          if (ok) { if (!stop) setV4Key(k); return; }
        }
      } catch { /* lookup is best effort */ }
    })();
    return () => { stop = true; };
  }, [noRoute, longTail, pub, net, CONTRACTS.v4, WHYPE, USDC]);

  const pick = (side: "sell" | "buy", t: Token) => {
    if (side === "sell") { if (t.address === buy.address) setBuy(sell); setSell(t); }
    else { if (t.address === sell.address) setSell(buy); setBuy(t); }
    setMenu(null); setQuote(null); setMsg(null); setAckToken(false); setAckImpact(false);
  };
  const flip = () => { if (busy) return; setSell(buy); setBuy(sell); setQuote(null); };

  // deep link: /trade?chain=robinhood&sell=ETH&buy=0x… (ticker or address); applied once, on the network it names
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !pub) return;
    const p = new URLSearchParams(location.search);
    const c = p.get("chain");
    if (c && c !== net.key) return;
    linked.current = true;
    const all = stoa && !tokens.some((t) => t.address === stoa.address) ? [...tokens, stoa] : tokens;
    const find = (v: string) => all.find((t) => t.address.toLowerCase() === v.toLowerCase() || t.symbol.toLowerCase() === v.toLowerCase());
    let s = sell, b = buy;
    const want = { sell: p.get("sell")?.trim(), buy: p.get("buy")?.trim() };
    const custom: ["sell" | "buy", string][] = [];
    for (const side of ["sell", "buy"] as const) {
      const v = want[side];
      if (!v) continue;
      const t = find(v);
      if (t) { if (side === "sell") s = t; else b = t; }
      else if (isAddress(v)) custom.push([side, v]);
    }
    if (s.address === b.address) b = s.address === net.tokens[0].address ? net.tokens[2] : net.tokens[0];
    setSell(s); setBuy(b);
    (async () => { for (const [side, v] of custom) await addCustom(v, side); })();
  }, [pub]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCustom(addr: string, side: "sell" | "buy") {
    if (!isAddress(addr) || !pub) return;
    const known = tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase());
    if (known) return pick(side, known);
    try {
      const [symbol, decimals] = await Promise.all([
        pub.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }),
        pub.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
      ]);
      const sym = String(symbol).replace(/[^\w.$-]/g, "").slice(0, 12) || "TOKEN";
      let name = "Unverified";
      if (net.pons) {
        try {
          const curve = await pub.readContract({ address: net.pons, abi: ponsAdapterAbi, functionName: "curveOf", args: [addr] });
          if (curve !== zeroAddress) name = "Pons curve · unverified";
        } catch { /* adapter not deployed on this build */ }
      }
      // a Robinhood Stock Token gets its name and logo from Robinhood's own list (matched by address)
      let logo: string | undefined;
      if (net.key === "robinhood") {
        const st = (await stockList()).find((x) => x.address.toLowerCase() === addr.toLowerCase());
        if (st) { name = `${st.name} · Robinhood Stock Token`; logo = st.logo ?? undefined; }
      }
      const t: Token = { symbol: sym, name, address: addr, decimals: Number(decimals), glyph: sym[0] ?? "?", tone: "other", logo };
      setTokens((ts) => [...ts, t]);
      pick(side, t);
    } catch {
      setMsg({ ok: false, text: `That address is not an ERC-20 token on ${net.name}.` });
    }
  }

  // the form as it is now: a swap prepared from an older form is not sent (see sameForm)
  const live = useRef<SwapForm>({ amount, slip, sell: sell.address, buy: buy.address });
  live.current = { amount, slip, sell: sell.address, buy: buy.address };

  async function run(label: string, fn: () => Promise<Hash>, onOk?: (r: TransactionReceipt, hash: Hash) => void, why: (e: unknown) => string = (e) => explain(e, G)) {
    if (!pub) return;
    setBusy(label); setMsg(null); setDone(null);
    try {
      const hash = await fn();
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("Transaction reverted");
      setMsg({ ok: true, text: `${label} confirmed`, hash });
      onOk?.(r, hash);
      void native.refetch(); void sellBal.refetch(); void buyBal.refetch(); void allowance.refetch();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: why(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onAction() {
    const form: SwapForm = { amount, slip, sell: sell.address, buy: buy.address };
    if (!isConnected) return openWallet();
    if (wrongChain) return switchChain({ chainId: chain.id });
    if (!amt) return;
    if (needApprove) {
      return run(`Approve ${sell.symbol}`, () => writeContractAsync({ address: sell.address, abi: erc20Abi, functionName: "approve", args: [CONTRACTS.router!, unlimited ? maxUint256 : amt], chainId: chain.id }));
    }
    if (kind === "wrap") return run("Wrap", () => writeContractAsync({ address: WHYPE, abi: whypeAbi, functionName: "deposit", value: amt, chainId: chain.id }));
    if (kind === "unwrap") return run("Unwrap", () => writeContractAsync({ address: WHYPE, abi: whypeAbi, functionName: "withdraw", args: [amt], chainId: chain.id }));

    if (cover.on) {
      if (!cover.ok) return;
      const ok = await run("Covered buy", async () => {
        const fresh = await getQuote();
        if (!fresh?.route) throw new Error("No route for this swap right now.");
        if (fresh.impact >= IMPACT_BLOCK && !ackImpact) throw new Error(`Price impact is now ${fresh.impact.toFixed(1)}%. Confirm the high price impact to continue.`);
        setQuote(fresh);
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_S);
        const p = swapParams(sell, buy, fresh.route, amt, minOut(fresh.out, slip), address!, deadline, referrer ?? zeroAddress);
        const premium = (amt * BigInt(cover.term!.premiumBps)) / 10_000n;
        const value = amt + premium;
        let gas: bigint | undefined;
        try {
          const est = await pub!.estimateContractGas({ address: COVER!, abi: coverAbi, functionName: "buyCovered", args: [p], value, account: address! });
          gas = (est * 13n) / 10n + 50_000n;
        } catch { /* the wallet estimates; a revert shows up there */ }
        if (!sameForm(form, live.current)) throw new Error(FORM_CHANGED);
        return writeContractAsync({ address: COVER!, abi: coverAbi, functionName: "buyCovered", args: [p], value, gas, chainId: chain.id });
      }, (r, hash) => {
        let paid = amt, got: bigint | undefined;
        for (const l of r.logs) {
          if (l.address.toLowerCase() !== CONTRACTS.router!.toLowerCase()) continue;
          try { const ev = decodeEventLog({ abi: [routedEvent], data: l.data, topics: l.topics }); paid = ev.args.amountIn; got = ev.args.amountOut; break; } catch { /* another event */ }
        }
        cover.refetch();
        if (got !== undefined) setDone({ hash, net: net.key, symIn: sell.symbol, symOut: buy.symbol, inTxt: fmtAmt(paid, sell.decimals), outTxt: fmtAmt(got, buy.decimals), covered: true });
      }, explainCover);
      if (ok) { setAmount(""); setAckImpact(false); }
      return;
    }

    const ok = await run("Swap", async () => {
      const fresh = await getQuote(); // re-quote right before signing
      if (!fresh?.route) throw new Error("No route for this swap right now.");
      if (fresh.impact >= IMPACT_BLOCK && !ackImpact) throw new Error(`Price impact is now ${fresh.impact.toFixed(1)}%. Confirm the high price impact to continue.`);
      setQuote(fresh);
      const min = minOut(fresh.out, slip);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_S);
      const p = swapParams(sell, buy, fresh.route, amt, min, address!, deadline, referrer ?? zeroAddress);
      const value = kind === "hypeIn" ? amt : undefined;
      // Gas limit with headroom. Venue adapters pick their pool by simulating swaps inside try/catch, so the node's
      // estimate is the bare minimum for the current block: a price move before inclusion can need a little more and
      // the swap would run out of gas. 30% + 50k on top; only the gas actually used is paid.
      let gas: bigint | undefined;
      try {
        const est = await pub!.estimateContractGas({ address: CONTRACTS.router!, abi: routerAbi, functionName: "swap", args: [p], value, account: address! });
        gas = (est * 13n) / 10n + 50_000n;
      } catch { /* let the wallet estimate; a revert shows up there */ }
      if (!sameForm(form, live.current)) throw new Error(FORM_CHANGED);
      return writeContractAsync({ address: CONTRACTS.router!, abi: routerAbi, functionName: "swap", args: [p], value, gas, chainId: chain.id });
    }, (r, hash) => {
      // what the trader actually paid and got, from the router's Routed event in the receipt
      const s0 = sell, b0 = buy, a0 = amt;
      let paid = a0, got: bigint | undefined;
      for (const l of r.logs) {
        if (l.address.toLowerCase() !== CONTRACTS.router!.toLowerCase()) continue;
        try { const ev = decodeEventLog({ abi: [routedEvent], data: l.data, topics: l.topics }); paid = ev.args.amountIn; got = ev.args.amountOut; break; } catch { /* another event */ }
      }
      if (got === undefined) return;
      setDone({ hash, net: net.key, symIn: s0.symbol, symOut: b0.symbol, inTxt: fmtAmt(paid, s0.decimals), outTxt: fmtAmt(got, b0.decimals) });
    });
    if (ok) { setAmount(""); setAckImpact(false); }
  }

  // button
  let label = "Swap", disabled = false;
  if (!amt) { label = amount ? "Enter a valid amount" : "Enter an amount"; disabled = true; }
  else if (!isConnected) label = "Connect wallet";
  else if (wrongChain) label = `Switch to ${chain.name}`;
  else if (!deployed && kind !== "wrap" && kind !== "unwrap") { label = "Opens at launch"; disabled = true; }
  else if (isPaused && kind !== "wrap" && kind !== "unwrap") { label = "Swaps paused"; disabled = true; }
  else if (sBal !== undefined && amt + (cover.on ? cover.premium : 0n) > sBal) { label = `Not enough ${sell.symbol}`; disabled = true; }
  else if (quoting && !quote) { label = "Finding the best route…"; disabled = true; }
  else if (noRoute || !quote) { label = "No route for this pair"; disabled = true; }
  else if (risky && !ackToken) { label = "Confirm the token warning"; disabled = true; }
  else if (quote.impact >= IMPACT_BLOCK && !ackImpact) { label = "Confirm high price impact"; disabled = true; }
  else if (cover.on && !cover.ok) { label = "Not covered: untick Rug Cover to swap"; disabled = true; }
  else if (cover.on) label = `Buy with cover · pay ${fmt(amt + cover.premium, 18, 6)} ETH`;
  else if (needApprove) label = unlimited ? `Approve ${sell.symbol}` : `Approve ${fmt(amt, sell.decimals, 4)} ${sell.symbol}`;
  else if (kind === "wrap") label = `Wrap ${G}`;
  else if (kind === "unwrap") label = `Unwrap ${W}`;
  if (busy) { label = `${busy}…`; disabled = true; }

  const venueName = !quote ? "—" : !quote.route ? `${W} contract` : describeRoute(quote.route, VENUE_NAMES, W);
  // a fill on a Pons curve: its fee and the token's creator tax are already in the quoted amount; say so
  const usesPons = !!net.pons && !!quote?.route && [quote.route.leg1.venue, quote.route.leg2?.venue].some((v) => !!v && v.toLowerCase() === net.pons!.toLowerCase());
  const ponsFees = useQuery({
    queryKey: ["pons-fees", sell.address, buy.address],
    enabled: usesPons && !!pub,
    staleTime: 300_000,
    queryFn: async () => {
      for (const t of [buy, sell]) {
        if (isNative(t) || t.address.toLowerCase() === net.wrapped.toLowerCase()) continue;
        const curve = await pub!.readContract({ address: net.pons!, abi: ponsAdapterAbi, functionName: "curveOf", args: [t.address] });
        if (curve === zeroAddress) continue;
        const [fee, tax] = await Promise.all([
          pub!.readContract({ address: curve, abi: ponsCurveAbi, functionName: "feeBps" }),
          pub!.readContract({ address: curve, abi: ponsCurveAbi, functionName: "creatorTaxBps" }),
        ]);
        return { fee: Number(fee) / 100, tax: Number(tax) / 100 };
      }
      return null;
    },
  });
  const px = quote && amt ? rate(amt, sell.decimals, quote.out, buy.decimals) : 0;
  const outTxt = quote ? fmtAmt(quote.out, buy.decimals) : "";

  return (
    <div className="grid2">
      <div className="panel pad" style={{ position: "relative" }}>
        {!deployed && <div className="notice">Stoa is not live on {net.name} yet. Wrapping {G} works; swaps open at launch.</div>}
        {deployed && isPaused && <div className="notice">Swaps are paused for safety. Your funds are not affected; wrapping {G} still works.</div>}
        {net.key === "robinhood" && isConnected && native.data?.value === 0n && (
          <div className="notice">No ETH on Robinhood Chain yet. <Link href="/bridge">Bridge in from Base, Arbitrum or Ethereum →</Link></div>
        )}
        <div className="rowx" style={{ marginBottom: 12 }}>
          <div className="seg" role="tablist">
            <button className={limitMode ? undefined : "on"} type="button" role="tab" aria-selected={!limitMode} onClick={() => setMode("swap")}>Swap</button>
            {limitLive && <button className={limitMode ? "on" : undefined} type="button" role="tab" aria-selected={limitMode} onClick={() => setMode("limit")}>Limit</button>}
          </div>
          <button className="ghost" type="button" style={{ borderColor: "var(--line)", background: "#fff" }} aria-label={`Swap settings, slippage ${slip}%`} aria-expanded={showSet} onClick={() => setShowSet((s) => !s)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>{slip}%
          </button>
          <div className={`panel pop${showSet ? " open" : ""}`}>
            <div className="lbl">MAX SLIPPAGE</div>
            <div className="seg" style={{ marginTop: 10 }}>{SLIPS.map((s) => <button key={s} type="button" className={s === slip ? "on" : undefined} disabled={!!busy} onClick={() => setSlip(s)}>{s}%</button>)}</div>
            <p className="note">If the price moves past your slippage before your swap lands, it reverts and you keep your funds.</p>
            <div className="lbl" style={{ marginTop: 14 }}>TOKEN APPROVAL</div>
            <label className="chk"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} /> Approve unlimited (fewer transactions, more exposure)</label>
            <p className="note">By default Stoa asks to approve only the amount of each swap.</p>
          </div>
        </div>

        <WatchChips net={net} onPick={(a, via) => { if (busy) return; const st = via && tokens.find((t) => t.symbol === via); if (st && st.address !== sell.address) pick("sell", st); addCustom(a, "buy"); }} />
        <div className="box">
          <div className="row"><label className="lbl" htmlFor="sellv">SELL</label>
            <button type="button" className="lbl" style={{ border: 0, background: "none", cursor: sBal ? "pointer" : "default" }} onClick={() => sBal && !busy && setAmount(fmt(isNative(sell) ? (sBal > 10n ** 16n ? sBal - 10n ** 16n : 0n) : sBal, sell.decimals, sell.decimals).replace(/,/g, ""))}>
              BALANCE {sBal !== undefined ? fmt(sBal, sell.decimals, 4) : "—"}
            </button></div>
          <div className="row" style={{ position: "relative" }}>
            <input id="sellv" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" value={amount} readOnly={!!busy} onChange={(e) => { setMsg(null); setDone(null); setAmount(e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "")); }} />
            <TokenBtn t={sell} onClick={() => !busy && setMenu(menu === "sell" ? null : "sell")} />
            {menu === "sell" && <TokenMenu net={net} covered={coveredSet} tokens={tokens} onPick={(t) => pick("sell", t)} onImport={(a) => addCustom(a, "sell")} onClose={closeMenu} />}
          </div>
          {sellUsd > 0 && <div className="usd">≈ {fmtUsd(sellUsd)}</div>}
        </div>
        <div className="flip"><button type="button" aria-label="Switch tokens" onClick={flip}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg></button></div>
        <div className="box">
          <div className="row"><span className="lbl" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>BUY{buy.tone === "other" && <WatchStar chain={net.key} address={buy.address} symbol={buy.symbol} logo={buy.logo} via={buy.name.endsWith("Robinhood Stock Token") ? "USDG" : undefined} small />}</span><span className="lbl">BALANCE {bBal !== undefined ? fmt(bBal, buy.decimals, 4) : "—"}</span></div>
          <div className="row" style={{ position: "relative" }}>
            <span className="out" style={{ fontSize: outTxt.length > 13 ? 20 : outTxt.length > 10 ? 24 : 28, color: quote ? "var(--ink)" : "#6F7886" }} title={quote ? fmt(quote.out, buy.decimals, buy.decimals) : undefined}>
              {quote ? outTxt : quoting && amt ? <i className="sk" style={{ width: 120, height: 22 }} /> : "0.00"}
            </span>
            <TokenBtn t={buy} onClick={() => !busy && setMenu(menu === "buy" ? null : "buy")} />
            {menu === "buy" && <TokenMenu net={net} covered={coveredSet} tokens={tokens} onPick={(t) => pick("buy", t)} onImport={(a) => addCustom(a, "buy")} onClose={closeMenu} />}
          </div>
          {quote && (usdOf(buy)?.usd ?? 0) > 0 && <div className="usd">≈ {fmtUsd((usdOf(buy)!.usd) * Number(formatUnits(quote.out, buy.decimals)))}</div>}
        </div>
        <MarketNote tokens={[sell, buy]} />
        {net.key === "robinhood" && !isNative(buy) && !/^(USDG|WETH|USDC|USDT)$/.test(buy.symbol) && <CmcPanel token={buy.address} />}

        {limitMode ? (
          <>
            {buy.tone === "other" && !isNative(buy) && (buy.name.endsWith("Robinhood Stock Token")
              ? <p className="note">{buy.symbol} is a Robinhood Stock Token, issued by Robinhood Assets (Jersey) Limited. Its pools trade against USDG, so sell USDG for the most direct route. <a href="/stocks">All stock tokens</a></p>
              : <SafetyPanel chain={net.key} token={buy.address} compact />)}
            <LimitPanel net={net} sell={sell} buy={buy} amt={amt} marketOut={quote?.out} sBal={sBal} referrer={referrer} tokens={tokens} warning={tokenWarning} gate={risky && !ackToken ? "Confirm the token warning" : undefined} />
          </>
        ) : (
          <>
        {amt && quote && (
          <div className="det">
            <span>Rate</span><span>1 {sell.symbol} = {Number(px.toPrecision(6)).toLocaleString("en-US", { maximumSignificantDigits: 6 })} {buy.symbol}</span>
            <span>Filled by</span><span>{venueName}</span>
            {usesPons && ponsFees.data && <><span>Curve fees</span><span>Pons {ponsFees.data.fee}% + creator tax {ponsFees.data.tax}% (in the price)</span></>}
            {kind !== "wrap" && kind !== "unwrap" && <><span>Protocol fee</span><span>2 bps</span>
              <span>Price impact</span><span style={{ color: quote.impact >= IMPACT_WARN ? "#B4532A" : undefined }}>{quote.impact < 0.01 ? "< 0.01" : quote.impact.toFixed(2)}%</span>
              <span>Minimum received</span><span>{fmtAmt(minOut(quote.out, slip), buy.decimals)} {buy.symbol}</span></>}
            {cover.on && <><span>Rug Cover premium</span><span>{fmtAmt(cover.premium, 18)} ETH, burned as $STOA</span></>}
            {referrer && <><span>Referred by</span><span>{referrer.slice(0, 6)}…{referrer.slice(-4)}</span></>}
          </div>
        )}
        {cover.block}
        {buy.tone === "other" && !isNative(buy) && (buy.name.endsWith("Robinhood Stock Token")
              ? <p className="note">{buy.symbol} is a Robinhood Stock Token, issued by Robinhood Assets (Jersey) Limited. Its pools trade against USDG, so sell USDG for the most direct route. <a href="/stocks">All stock tokens</a></p>
              : <SafetyPanel chain={net.key} token={buy.address} compact />)}
        {amt && quote?.route && kind !== "wrap" && kind !== "unwrap" && (
          <VenueCompare net={net} pub={pub} sell={sell} buy={buy} amt={amt} route={quote.route} out={quote.out} block={quote.block} />
        )}
        {amt && quote && quote.impact >= IMPACT_WARN && (
          <div className={quote.impact >= IMPACT_BLOCK ? "err" : "notice"} style={{ marginTop: 12, marginBottom: 0 }}>
            Price impact is {quote.impact.toFixed(1)}%: this trade moves the price a lot because the pool is thin.
            {quote.impact >= IMPACT_BLOCK && <label className="chk"><input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} /> I understand and want to swap anyway</label>}
          </div>
        )}
        {v4Key && longTail && (
          <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
            {longTail.symbol} trades on a Uniswap V4 pool that Stoa&apos;s router does not use yet. Stoa&apos;s keeper adds the most traded Uniswap V4 pools every day, and Pons graduation pools usually within the hour.
          </div>
        )}
        {noRoute && !v4Key && stoa && [sell.address, buy.address].includes(stoa.address) && (
          <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
            ${stoa.symbol} still trades on its Pons bonding curve. Stoa routes it as soon as it graduates to its Uniswap V4 pool; until then, buy it on Pons.
            <div style={{ marginTop: 10 }}><a className="ghost" style={{ display: "inline-flex", borderColor: "var(--line)", background: "#fff" }} href={`https://ponsfamily.com/launchpad/${stoa.address}`} target="_blank" rel="noopener noreferrer">Buy ${stoa.symbol} on Pons ↗</a></div>
          </div>
        )}
        {(() => {
          // the router hops only through the wrapped gas token; some tokens trade only against the stablecoin
          const st = tokens.find((t) => t.address.toLowerCase() === USDC.toLowerCase());
          const isSt = (t: Token) => t.address.toLowerCase() === USDC.toLowerCase();
          if (!noRoute || v4Key || !st || isSt(sell) || isSt(buy) || sell.tone === "other" || buy.tone === "other" || (stoa && [sell.address, buy.address].includes(stoa.address))) return null;
          return (
            <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
              No route between these two right now. Some tokens only trade against {st.symbol}: swap to {st.symbol} first, then from {st.symbol} to {buy.symbol}.
              <div style={{ marginTop: 10 }}><button type="button" className="ghost" onClick={() => pick("buy", st)}>Swap to {st.symbol} first</button></div>
            </div>
          );
        })()}
        {tokenWarning}
        <button className="big pri" type="button" disabled={disabled} onClick={onAction}>{label}</button>
        {msg && !done && <div className={msg.ok ? "ok" : "err"}>{msg.text}{msg.hash && <> · <a href={txUrl(msg.hash)} target="_blank" rel="noopener noreferrer">View</a></>}</div>}
        {done && (() => {
          const link = `${SITE}/swap/${done.net}/${done.hash}${address ? `?ref=${address}` : ""}`;
          const text = `Swapped ${done.inTxt} ${done.symIn} for ${done.outTxt} ${done.symOut} on @StoaDEX. Every route compared, filled on the best one.`;
          const post = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`;
          return (
            <div className="sharecard">
              <div className="rowx"><span className="lbl">SWAP CONFIRMED</span><a className="lbl" href={txUrl(done.hash)} target="_blank" rel="noopener noreferrer">VIEW ↗</a></div>
              <div className="sc-amt">{done.inTxt} {done.symIn} → <b>{done.outTxt} {done.symOut}</b></div>
              {done.covered && <p className="note" style={{ marginTop: 4 }}>Covered: if the creator&apos;s wallet drops below its floor before release, claim your ETH on <a href="/cover">Rug Cover</a>.</p>}
              <div className="sc-btns">
                <a className="sc-x" href={post} target="_blank" rel="noopener noreferrer">Share on X</a>
                <button type="button" className="ghost" onClick={async () => { if ((await shareOrCopy(link, text)) === "copied") { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}>{copied ? "Link copied" : "Share link"}</button>
              </div>
              <p className="note">Your link carries your referral: you earn 10% of Stoa&apos;s fee on every swap made through it.</p>
            </div>
          );
        })()}
          </>
        )}
        <p className="note">{net.makers ? `Native ${G} works directly. Maker pools cap each fill at $500 while they ramp up.` : `Native ${G} works directly. Swaps on ${net.name} fill on the best live venue; maker pools come later.`}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {net.makers && <PoolDepth />}
        <div className="panel pad">
          <div className="lbl">EVERY SWAP ON {net.short.toUpperCase()} CHECKS</div>
          <div className="src">
            {net.makers && <div>Stoa maker pools <em>{CONTRACTS.pool ? "IN ROUTER" : "OPENING SOON"}</em></div>}
            <div>Uniswap V2 · V3 · V4 <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div>
            {net.makers && <div>Aero · Ramses <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div>}
            {!net.makers && net.newVenues.length > 0 && <div>{net.newVenues.map((v) => v.name).join(" · ")} <em>{newVenuesLive ? "LIVE" : "BEING ADDED"}</em></div>}
            {net.pons && <div>Pons launch curves <em>{ponsLive ? "LIVE" : "BEING ADDED"}</em></div>}
            {net.makers && <div>Liquidity Book <em>{deployed ? "LIVE" : "AT LAUNCH"}</em></div>}
          </div>
          <p className="note">Every swap compares these venues, directly and through {W}, and fills on the best one.{net.makers ? " When a maker quotes better, the router uses it automatically." : ""}</p>
        </div>
        {net.key === "robinhood" && (
          <a className="panel pad" href="/check" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
            <div className="lbl">NOT SURE ABOUT A TOKEN?</div>
            <p style={{ marginTop: 8 }}>Check it free before you buy: a simulated buy and sell-back, hidden taxes and who holds it. Nothing to sign. <b style={{ color: "var(--accent)" }}>stoadex.com/check →</b></p>
          </a>
        )}
      </div>
    </div>
  );
}

/** While the US market is closed, a stock token's pools have no live reference price (Robinhood prices the tokens from
 *  the underlying shares), so they can drift: say so next to the form. Shown only for Robinhood Stock Tokens. */
function MarketNote({ tokens }: { tokens: Token[] }) {
  const [closed, setClosed] = useState(false);
  useEffect(() => { const f = () => setClosed(usSession() === "closed"); f(); const t = setInterval(f, 60_000); return () => clearInterval(t); }, []);
  const st = tokens.find((t) => t.name.endsWith("Robinhood Stock Token"));
  if (!st || !closed) return null;
  return <div className="notice" style={{ marginTop: 10 }}>The US market is closed, so Robinhood is not pricing {st.symbol} until it reopens and its on-chain pools can drift from the last price. Check the rate before you swap.</div>;
}

let stocksP: Promise<{ address: string; name: string; logo: string | null }[]> | null = null;
/** Robinhood's Stock Token list, from Stoa's own API (fetched once per visit, only when an unknown token is opened) */
const stockList = () => (stocksP ??= fetch("/api/v1/stocks").then((r) => (r.ok ? r.json() : { stocks: [] })).then((j: { stocks?: { address: string; name: string; logo: string | null }[] }) => (Array.isArray(j.stocks) ? j.stocks : [])).catch(() => []));

/** the tokens in this browser's watchlist on this network, one tap to buy */
function WatchChips({ net, onPick }: { net: Net; onPick: (address: string, via?: string) => void }) {
  const s = useWatch();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mine = s.watch.filter((w) => w.chain === net.key).slice(0, 12);
  if (!mounted || !mine.length) return null;
  return (
    <div className="wchips" aria-label="Your watchlist">
      <span className="lbl">WATCHLIST</span>
      {mine.map((w) => (
        <button key={w.address} type="button" className="wchip" onClick={() => onPick(w.address, w.via)} title={`Buy ${w.symbol}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {w.logo && !w.logo.includes("cdn.robinhood.com") && <img src={w.logo} alt="" width={18} height={18} />}{w.symbol}
        </button>
      ))}
    </div>
  );
}

function TokenBtn({ t, onClick }: { t: Token; onClick: () => void }) {
  return <button className="tok" type="button" aria-haspopup="listbox" onClick={onClick}><TokenIcon t={t} />{t.symbol}</button>;
}

function TokenMenu({ net, tokens, covered, onPick, onImport, onClose }: { net: Net; tokens: Token[]; covered?: Set<string>; onPick: (t: Token) => void; onImport: (a: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sheet, setSheet] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => tokens.filter((t) => (t.symbol + t.name + t.address).toLowerCase().includes(q.toLowerCase())), [tokens, q]);
  const priceOf = usePrices(net, tokens);
  useEffect(() => {
    setSheet(matchMedia("(max-width:560px)").matches);
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(el) && !el.closest(".tok")) onClose();
    };
    addEventListener("keydown", key); addEventListener("mousedown", down);
    return () => { removeEventListener("keydown", key); removeEventListener("mousedown", down); };
  }, [onClose]);
  const body = (
    <div ref={ref} className={`panel tokm open${sheet ? " sheet" : ""}`} role="listbox" aria-label="Select a token">
      {sheet && <div className="rowx tokh"><b>Select a token</b><button className="x" type="button" onClick={onClose} aria-label="Close">×</button></div>}
      <input placeholder="Search or paste address" value={q} onChange={(e) => setQ(e.target.value.trim())} aria-label="Search token" autoFocus={!sheet} />
      <div className="tokl">
        {net.key === "robinhood" && !q && <SpotlightPicks onImport={onImport} />}
        {list.map((t) => <button key={t.address} type="button" role="option" aria-selected="false" onClick={() => onPick(t)}><TokenIcon t={t} /><span className="tokn"><b>{t.symbol}{covered?.has(t.address.toLowerCase()) && <span className="chip cov">Covered</span>}</b><small className={t.tone === "bridged" ? "vf" : undefined}>{t.address === NATIVE ? "Native" : t.name}</small></span>{(() => { const p = priceOf(t); return p ? <span className="tokp"><b>{fmtUsd(p.usd)}</b>{p.ch24 !== undefined && <small className={p.ch24 >= 0 ? "up" : "dn"}>{p.ch24 >= 0 ? "+" : ""}{p.ch24.toFixed(1)}%</small>}</span> : null; })()}</button>)}
        {list.length === 0 && isAddress(q) && <button type="button" onClick={() => onImport(q)}>Import {q.slice(0, 6)}…{q.slice(-4)}</button>}
        {list.length === 0 && !isAddress(q) && <p className="note" style={{ padding: "0 8px" }}>Paste a token address to import it.</p>}
      </div>
    </div>
  );
  return sheet ? createPortal(<div className="tokbg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>{body}</div>, document.body) : body;
}
