"use client";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import Link from "next/link";
import { CONTRACTS, elysium } from "@/lib/chain";
import { TOKENS, isNative } from "@/lib/tokens";
import { feesAbi } from "@/lib/abi";
import { fmt } from "@/lib/swap";
import { useWalletModal } from "./Providers";
import { TokenIcon } from "./ui";

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const native = useBalance({ address, chainId: elysium.id, query: { enabled: !!address } });
  const erc = TOKENS.filter((t) => !isNative(t));
  const bals = useReadContracts({ contracts: erc.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [address!] as const, chainId: elysium.id })), query: { enabled: !!address } });
  const refs = useReadContracts({ contracts: erc.map((t) => ({ address: CONTRACTS.fees!, abi: feesAbi, functionName: "referralOwed" as const, args: [address!, t.address] as const, chainId: elysium.id })), query: { enabled: !!address && !!CONTRACTS.fees } });

  if (!isConnected) {
    return <div className="panel empty"><img src="/logo.png" alt="" style={{ width: 64, height: 64 }} /><h3>Nothing here yet</h3><p>Connect a wallet to see your balances and positions on Stoa.</p><button className="cta" type="button" onClick={open}>Connect wallet</button></div>;
  }
  const bal = (i: number) => (bals.data?.[i]?.result as bigint | undefined);
  return (
    <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
      <div className="panel" style={{ overflow: "hidden" }}>
        <table className="tbl"><thead><tr><th>TOKEN</th><th style={{ textAlign: "right" }}>BALANCE</th></tr></thead>
          <tbody>
            {TOKENS.map((t) => {
              const v = isNative(t) ? native.data?.value : bal(erc.indexOf(t));
              return <tr key={t.symbol}><td><span className="pair"><TokenIcon t={t} />{t.symbol}</span></td><td style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{v !== undefined ? fmt(v, t.decimals, 6) : "—"}</td></tr>;
            })}
          </tbody></table>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="panel pad"><div className="lbl">REFERRAL EARNINGS</div>
          <ul className="list">{erc.map((t, i) => <li key={t.symbol}>{t.symbol} <b>{CONTRACTS.fees ? fmt((refs.data?.[i]?.result as bigint | undefined) ?? 0n, t.decimals, 6) : "—"}</b></li>)}</ul>
          <Link className="go" href="/referrals">Referrals</Link></div>
        <div className="panel pad"><div className="lbl">VAULT SHARES</div><p className="note">Vaults open after the audit.</p></div>
      </div>
    </div>
  );
}
