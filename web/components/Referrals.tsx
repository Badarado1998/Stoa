"use client";
import { useState } from "react";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { CONTRACTS, SITE, elysium } from "@/lib/chain";
import { USDC, WHYPE } from "@/lib/tokens";
import { feesAbi } from "@/lib/abi";
import { fmt } from "@/lib/swap";
import { useWalletModal } from "./Providers";
import CopyButton from "./CopyButton";

const TOK = [{ s: "USDC", a: USDC, d: 6 }, { s: "WHYPE", a: WHYPE, d: 18 }];

export default function Referrals() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const pub = usePublicClient({ chainId: elysium.id });
  const { writeContractAsync } = useWriteContract();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const owed = useReadContracts({
    contracts: TOK.map((t) => ({ address: CONTRACTS.fees!, abi: feesAbi, functionName: "referralOwed" as const, args: [address!, t.a] as const, chainId: elysium.id })),
    query: { enabled: !!address && !!CONTRACTS.fees, refetchInterval: 15_000 },
  });
  const amounts = TOK.map((_, i) => (owed.data?.[i]?.result as bigint | undefined) ?? 0n);
  const any = amounts.some((a) => a > 0n);
  const link = address ? `${SITE}/trade?ref=${address}` : "";

  async function claim() {
    if (!pub || !address) return;
    setBusy(true); setMsg(null);
    try {
      const hash = await writeContractAsync({ address: CONTRACTS.fees!, abi: feesAbi, functionName: "claimReferral", args: [TOK.filter((_, i) => amounts[i] > 0n).map((t) => t.a), address], chainId: elysium.id });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("Transaction reverted");
      setMsg({ ok: true, t: "Claimed" }); void owed.refetch();
    } catch (e) {
      setMsg({ ok: false, t: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div className="grid2">
      <div className="panel pad">
        <div className="lbl">YOUR LINK</div>
        {!isConnected ? (
          <div className="empty" style={{ padding: "28px 10px" }}><p>Connect a wallet to create your referral link.</p><button className="cta" type="button" onClick={open}>Connect wallet</button></div>
        ) : (
          <>
            <div className="box" style={{ marginTop: 12 }}><div className="row"><span className="addrchip" style={{ wordBreak: "break-all" }}>{link}</span><CopyButton text={link} /></div></div>
            <div className="lbl" style={{ marginTop: 20 }}>EARNED, NOT CLAIMED</div>
            <ul className="list">{TOK.map((t, i) => <li key={t.s}>{t.s} <b>{CONTRACTS.fees ? fmt(amounts[i], t.d, 6) : "—"}</b></li>)}</ul>
            <button className="big pri" type="button" disabled={!any || busy || !CONTRACTS.fees} onClick={claim}>{busy ? "Claiming…" : !CONTRACTS.fees ? "Opens at launch" : any ? "Claim" : "Nothing to claim yet"}</button>
            {msg && <div className={msg.ok ? "ok" : "err"}>{msg.t}</div>}
          </>
        )}
      </div>
      <div className="panel pad"><div className="lbl">HOW IT WORKS</div><ul className="list"><li>Share your stoa.trade link <b>Any channel</b></li><li>Friends trade through it <b>Remembered on their device</b></li><li>You earn from their swaps <b>10% of protocol fee</b></li></ul></div>
    </div>
  );
}
