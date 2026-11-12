"use client";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import Link from "next/link";
import { CONTRACTS, elysium } from "@/lib/chain";
import { TOKENS, VERIFIED, isNative } from "@/lib/tokens";

const ALL = [...TOKENS, ...VERIFIED];
const CORE = new Set(TOKENS.map((t) => t.address));
import { feesAbi } from "@/lib/abi";
import { fmt } from "@/lib/swap";
import { useWalletModal } from "./Providers";
import { TokenIcon } from "./ui";
import SwapHistory from "./SwapHistory";

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const native = useBalance({ address, chainId: elysium.id, query: { enabled: !!address } });
  const erc = ALL.filter((t) => !isNative(t));
  const bals = useReadContracts({ contracts: erc.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address!] as const, chainId: elysium.id })), query: { enabled: !!address } });
  const refs = useReadContracts({ contracts: erc.map((t) => ({ address: CONTRACTS.fees!, abi: feesAbi, functionName: "referralOwed" as const, args: [address!, t.address] as const, chainId: elysium.id })), query: { enabled: !!address && !!CONTRACTS.fees } });

  if (!isConnected) {
    return <div className="panel empty"><img src="/logo.png" alt="" style={{ width: 64, height: 64 }} /><h3>Nothing here yet</h3><p>Connect a wallet to see your balances and positions on Stoa.</p><button className="cta" type="button" onClick={open}>Connect wallet</button></div>;
  }
  const bal = (i: number) => (bals.data?.[i]?.result as bigint | undefined);
  return (
    <div className="grid2 eq">
      <div className="panel" style={{ overflow: "hidden" }}>
        <table className="tbl"><thead><tr><th>TOKEN</th><th style={{ textAlign: "right" }}>BALANCE</th></tr></thead>
          <tbody>
            {ALL.map((t) => {
              const v = isNative(t) ? native.data?.value : bal(erc.indexOf(t));
              if (!CORE.has(t.address) && !v) return null; // verified tokens show only when held
              return <tr key={t.symbol}><td><span className="pair"><TokenIcon t={t} />{t.symbol}</span></td><td style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{v !== undefined ? fmt(v, t.decimals, 6) : "—"}</td></tr>;
            })}
          </tbody></table>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="panel pad"><div className="lbl">REFERRAL EARNINGS</div>
          <ul className="list">{erc.map((t, i) => (!CORE.has(t.address) && !(refs.data?.[i]?.result as bigint | undefined)) ? null : <li key={t.symbol}>{t.symbol} <b>{CONTRACTS.fees ? fmt((refs.data?.[i]?.result as bigint | undefined) ?? 0n, t.decimals, 6) : "—"}</b></li>)}</ul>
          <Link className="go" href="/referrals">Referrals</Link></div>
        <div className="panel pad"><div className="lbl">VAULT SHARES</div><p className="note">Vaults open after the audit.</p></div>
      </div>
      <div className="panel pad" style={{ gridColumn: "1 / -1", overflowX: "auto" }}><div className="lbl" style={{ marginBottom: 12 }}>YOUR SWAPS</div><SwapHistory /></div>
    </div>
  );
}
