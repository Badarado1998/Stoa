"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, parseUnits, type Address, type Hash } from "viem";
import { useQuery } from "@tanstack/react-query";
import { ROBINHOOD, txUrlOn } from "@/lib/networks";
import { AI_MIN_USD, AI_SLIP_BPS, AUTO_INVEST, AUTO_INVEST_RUNNER, FREQUENCIES, autoInvestAbi } from "@/lib/autoInvest";
import { useWalletModal } from "./Providers";
import { Ticker } from "./ui";

type StockOpt = { symbol: string; name: string; address: Address; logo: string | null };
const USDG = ROBINHOOD.stable;
const COUNTS = [4, 8, 12, 26, 52];
const when = (t: number) => new Date(t * 1000).toUTCString().slice(5, 22) + " UTC";

/** Recurring buys of Robinhood Chain stock tokens with USDG (lib/autoInvest.ts). */
export default function AutoInvest() {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  const { switchChain } = useSwitchChain();
  const pub = usePublicClient({ chainId: ROBINHOOD.chain.id });
  const { writeContractAsync } = useWriteContract();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<StockOpt | null>(null);
  const [amount, setAmount] = useState("25");
  const [freq, setFreq] = useState(1);
  const [count, setCount] = useState(12);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: Hash } | null>(null);

  const stocks = useQuery({
    queryKey: ["ai-stocks"],
    staleTime: 300_000,
    queryFn: async () => {
      const j = (await (await fetch("/api/v1/stocks")).json()) as { stocks?: (StockOpt & { routeOnStoa?: boolean })[] };
      return (j.stocks ?? []).filter((s) => s.routeOnStoa);
    },
  });
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (stocks.data ?? []).filter((s) => !k || s.symbol.toLowerCase().includes(k) || s.name.toLowerCase().includes(k)).slice(0, 12);
  }, [stocks.data, q]);
  useEffect(() => { if (!pick && stocks.data?.length) setPick(stocks.data[0]); }, [stocks.data, pick]);

  const amt = (() => { try { const v = parseUnits(amount || "0", 6); return v > 0n ? v : null; } catch { return null; } })();
  const total = amt ? amt * BigInt(count) : 0n;
  const allowance = useReadContract({ address: USDG, abi: erc20Abi, functionName: "allowance", args: [address ?? USDG, AUTO_INVEST ?? USDG], chainId: ROBINHOOD.chain.id, query: { enabled: !!address && !!AUTO_INVEST } });
  const bal = useReadContract({ address: USDG, abi: erc20Abi, functionName: "balanceOf", args: [address ?? USDG], chainId: ROBINHOOD.chain.id, query: { enabled: !!address } });
  const ids = useReadContract({ address: AUTO_INVEST, abi: autoInvestAbi, functionName: "plansOf", args: [address ?? USDG], chainId: ROBINHOOD.chain.id, query: { enabled: !!address && !!AUTO_INVEST } });
  const plans = useQuery({
    queryKey: ["ai-plans", address, (ids.data ?? []).length],
    enabled: !!pub && !!AUTO_INVEST && !!ids.data?.length,
    queryFn: async () => {
      const ps = await Promise.all([...(ids.data ?? [])].reverse().map(async (id) => ({ id, p: await pub!.readContract({ address: AUTO_INVEST!, abi: autoInvestAbi, functionName: "plan", args: [id] }) })));
      return ps;
    },
  });
  const symOf = (a: string) => stocks.data?.find((s) => s.address.toLowerCase() === a.toLowerCase())?.symbol ?? `${a.slice(0, 6)}…`;

  async function send(label: string, fn: () => Promise<Hash>) {
    setBusy(label); setMsg(null);
    try {
      const hash = await fn();
      const r = await pub!.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The transaction reverted.");
      setMsg({ ok: true, text: `${label}: confirmed`, hash });
      void allowance.refetch(); void ids.refetch(); void plans.refetch(); void bal.refetch();
    } catch (e) {
      const t = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, text: /reject|denied/i.test(t) ? "You declined it in your wallet." : t.split("\n")[0].slice(0, 160) });
    } finally { setBusy(null); }
  }

  if (!AUTO_INVEST || !AUTO_INVEST_RUNNER) {
    return <div className="panel pad"><p className="note" style={{ margin: 0 }}>Auto-invest opens after its contract has had an independent security review.</p></div>;
  }
  const wrong = isConnected && chainId !== ROBINHOOD.chain.id;
  const tooSmall = amt !== null && Number(formatUnits(amt, 6)) < AI_MIN_USD;
  const needApprove = !!amt && ((allowance.data as bigint | undefined) ?? 0n) < amt;
  let label = "Start auto-invest", disabled = false;
  if (!isConnected) label = "Connect wallet";
  else if (wrong) label = "Switch to Robinhood Chain";
  else if (!pick) { label = "Pick a stock token"; disabled = true; }
  else if (!amt) { label = "Enter an amount"; disabled = true; }
  else if (tooSmall) { label = `At least $${AI_MIN_USD} a buy`; disabled = true; }
  else if (needApprove) label = `Approve ${formatUnits(total, 6)} USDG`;
  if (busy) { label = `${busy}…`; disabled = true; }

  function onAction() {
    if (!isConnected) return open();
    if (wrong) return switchChain({ chainId: ROBINHOOD.chain.id });
    if (!pick || !amt) return;
    if (needApprove) return send("Approve USDG", () => writeContractAsync({ address: USDG, abi: erc20Abi, functionName: "approve", args: [AUTO_INVEST!, total], chainId: ROBINHOOD.chain.id }));
    return send(`Auto-invest in ${pick.symbol}`, () => writeContractAsync({
      address: AUTO_INVEST!, abi: autoInvestAbi, functionName: "create", chainId: ROBINHOOD.chain.id,
      args: [USDG, pick.address, amt, FREQUENCIES[freq].secs, count, AI_SLIP_BPS, 0n, AUTO_INVEST_RUNNER!],
    }));
  }

  return (
    <div className="grid2" style={{ alignItems: "start" }}>
      <div className="panel pad">
        <div className="lbl">BUY</div>
        <input type="search" placeholder="Search a stock token" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginTop: 8 }} className="box" />
        <div className="tchips" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {list.map((s) => (
            <button key={s.address} type="button" className={pick?.address === s.address ? "chip on" : "chip"} onClick={() => setPick(s)} aria-pressed={pick?.address === s.address} style={{ display: "inline-flex", alignItems: "center", gap: 6, ...(pick?.address === s.address ? { background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" } : {}) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {s.logo ? <img src={s.logo} alt="" width={18} height={18} /> : <Ticker symbol={s.symbol} size={18} />}{s.symbol}
            </button>
          ))}
          {stocks.isLoading && <span className="note">Loading stock tokens…</span>}
        </div>
        <div className="lbl" style={{ marginTop: 16 }}>EACH BUY (USDG)</div>
        <input className="box" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, ""))} style={{ width: "100%", marginTop: 8 }} />
        <div className="lbl" style={{ marginTop: 16 }}>HOW OFTEN</div>
        <div className="seg" style={{ marginTop: 8, flexWrap: "wrap" }}>{FREQUENCIES.map((f, i) => <button key={f.label} type="button" className={i === freq ? "on" : undefined} onClick={() => setFreq(i)}>{f.label}</button>)}</div>
        <div className="lbl" style={{ marginTop: 16 }}>HOW MANY BUYS</div>
        <div className="seg" style={{ marginTop: 8, flexWrap: "wrap" }}>{COUNTS.map((c) => <button key={c} type="button" className={c === count ? "on" : undefined} onClick={() => setCount(c)}>{c}</button>)}</div>
        <div className="det" style={{ marginTop: 14 }}>
          <span>Plan</span><span>{amt ? `${formatUnits(amt, 6)} USDG` : "—"} of {pick?.symbol ?? "—"}, {FREQUENCIES[freq].label.toLowerCase()}, {count} times</span>
          <span>Total over the plan</span><span>{amt ? `${formatUnits(total, 6)} USDG` : "—"}</span>
          <span>Your USDG</span><span>{bal.data !== undefined ? formatUnits(bal.data as bigint, 6) : "—"}</span>
          <span>Slippage per buy</span><span>up to {AI_SLIP_BPS / 100}%</span>
          <span>Gas</span><span>Paid by Stoa</span>
        </div>
        <button type="button" className="big pri" style={{ width: "100%", marginTop: 14 }} disabled={disabled} onClick={onAction}>{label}</button>
        {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}{msg.hash && <> · <a href={txUrlOn(ROBINHOOD, msg.hash)} target="_blank" rel="noopener noreferrer">View</a></>}</div>}
        <p className="note">Your USDG stays in your wallet. Each buy takes one amount and swaps it through the Stoa router straight to you, at no more than {AI_SLIP_BPS / 100}% below the router&apos;s quote; a buy that cannot be made (not enough USDG, price) is skipped and tried again. Stop any time. Stock tokens are not available to US persons and in some other countries.</p>
      </div>
      <div className="panel pad">
        <div className="lbl">YOUR PLANS</div>
        {!isConnected ? <p className="note">Connect a wallet to see your plans.</p>
          : !ids.data?.length ? <p className="note">No plans yet.</p>
          : (plans.data ?? []).map(({ id, p }) => (
            <div key={String(id)} className="rowx" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <span>
                <b>{formatUnits(p.amount, 6)} USDG → {symOf(p.tokenOut)}</b>
                <small style={{ display: "block", color: "var(--muted)" }}>
                  every {Math.round(p.interval / 86_400)} day{p.interval >= 172_800 ? "s" : ""} · {p.left ? `${p.left} left, next ${when(Number(p.nextAt))}` : "finished or stopped"}
                </small>
              </span>
              {p.left > 0 && <button type="button" className="ghost" disabled={!!busy} onClick={() => send("Stop plan", () => writeContractAsync({ address: AUTO_INVEST!, abi: autoInvestAbi, functionName: "cancel", args: [id], chainId: ROBINHOOD.chain.id }))}>Stop</button>}
            </div>
          ))}
      </div>
    </div>
  );
}
