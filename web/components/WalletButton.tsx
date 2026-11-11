"use client";
import { useAccount } from "wagmi";
import { elysium } from "@/lib/chain";
import { useWalletModal } from "./Providers";
import { short } from "./WalletModal";

export default function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  if (!isConnected) return <button className="cta" type="button" onClick={open}>Connect</button>;
  const wrong = chainId !== elysium.id;
  return (
    <button className={wrong ? "cta" : "ghost"} type="button" onClick={open} style={wrong ? { background: "#B4532A" } : undefined}>
      <span className="addrchip">{wrong ? "Wrong network" : short(address)}</span>
    </button>
  );
}
