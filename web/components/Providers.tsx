"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { WagmiProvider, useAccount, useSwitchChain } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { ELYSIUM, netById, netByKey, type Net } from "@/lib/networks";
import WalletModal from "./WalletModal";

const WalletCtx = createContext<{ open: () => void }>({ open: () => {} });
export const useWalletModal = () => useContext(WalletCtx);

const NetCtx = createContext<{ net: Net; setNet: (n: Net) => void }>({ net: ELYSIUM, setNet: () => {} });
/** The network the app is showing. It follows the wallet's chain when the wallet is on a supported one. */
export const useNet = () => useContext(NetCtx).net;
export const useSetNet = () => useContext(NetCtx).setNet;

function NetProvider({ children }: { children: ReactNode }) {
  const [net, setNetState] = useState<Net>(ELYSIUM);
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  useEffect(() => {
    let k: string | null = new URLSearchParams(location.search).get("chain");
    try { if (!k) k = localStorage.getItem("stoa.net"); } catch { /* storage blocked */ }
    const n = netByKey(k);
    if (n) setNetState(n);
  }, []);
  // follow the wallet when it moves to another supported chain
  useEffect(() => {
    const n = isConnected ? netById(chainId) : undefined;
    if (n && n.key !== net.key) setNetState(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, isConnected]);
  const setNet = useCallback((n: Net) => {
    setNetState(n);
    try { localStorage.setItem("stoa.net", n.key); } catch { /* storage blocked */ }
    if (isConnected && chainId !== n.chain.id) switchChain({ chainId: n.chain.id });
  }, [isConnected, chainId, switchChain]);
  return <NetCtx.Provider value={{ net, setNet }}>{children}</NetCtx.Provider>;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  const [open, setOpen] = useState(false);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <NetProvider>
          <WalletCtx.Provider value={{ open: () => setOpen(true) }}>
            {children}
            <WalletModal open={open} onClose={() => setOpen(false)} />
          </WalletCtx.Provider>
        </NetProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
