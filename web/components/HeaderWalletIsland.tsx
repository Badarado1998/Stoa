"use client";
import { useEffect } from "react";
import Providers, { useWalletModal } from "./Providers";
import WalletButton from "./WalletButton";
import NetSwitch from "./NetSwitch";

function OpenOnce({ open }: { open: boolean }) {
  const { open: show } = useWalletModal();
  useEffect(() => { if (open) show(); }, [open, show]);
  return null;
}

/** the header's wallet part with its own Providers: the same wagmi config and network store as the page's, so the
 *  connection and the network stay in step */
export default function HeaderWalletIsland({ openOnMount }: { openOnMount: boolean }) {
  return (
    <Providers>
      <NetSwitch />
      <WalletButton />
      <OpenOnce open={openOnMount} />
    </Providers>
  );
}
