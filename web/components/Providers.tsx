"use client";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { WagmiProvider, useAccount, useSwitchChain } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { ROBINHOOD, netById, netByKey, type Net } from "@/lib/networks";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
// the wallet picker and the price-alert watcher are not needed for the first paint: they load after it
const WalletModal = dynamic(() => import("./WalletModal"), { ssr: false });
const AlertWatcher = dynamic(() => import("./Watch").then((m) => m.AlertWatcher), { ssr: false });

const WalletCtx = createContext<{ open: () => void }>({ open: () => {} });
export const useWalletModal = () => useContext(WalletCtx);

// The network the app shows lives in one store for the whole page, not in a React context: the header's wallet button
// and a page each mount their own Providers (the wallet code loads only where it is needed), and both must agree.
let current: Net = ROBINHOOD;
const subs = new Set<() => void>();
const setCurrent = (n: Net) => { if (n.key === current.key) return; current = n; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The network the app is showing: Robinhood Chain for a first visit, then the one picked last (or named in ?chain=),
 *  and the wallet's chain whenever the wallet is on a supported one. */
export const useNet = () => useSyncExternalStore(subscribe, () => current, () => ROBINHOOD);
export const useSetNet = () => useContext(SetNetCtx);
const SetNetCtx = createContext<(n: Net) => void>(setCurrent);

function NetProvider({ children }: { children: ReactNode }) {
  const net = useNet();
  const { chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  useEffect(() => {
    let k: string | null = new URLSearchParams(location.search).get("chain");
    try { if (!k) k = localStorage.getItem("stoa.net"); } catch { /* storage blocked */ }
    const n = netByKey(k);
    if (n) setCurrent(n);
  }, []);
  // follow the wallet when it moves to another supported chain
  useEffect(() => {
    const n = isConnected ? netById(chainId) : undefined;
    if (n && n.key !== net.key) setCurrent(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, isConnected]);
  const setNet = useCallback((n: Net) => {
    setCurrent(n);
    try { localStorage.setItem("stoa.net", n.key); } catch { /* storage blocked */ }
    if (isConnected && chainId !== n.chain.id) switchChain({ chainId: n.chain.id });
  }, [isConnected, chainId, switchChain]);
  return <SetNetCtx.Provider value={setNet}>{children}</SetNetCtx.Provider>;
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
            {/* in a portal: the header's copy of these providers sits inside the header, whose styles would trap a fixed modal */}
            {open && createPortal(<WalletModal open={open} onClose={() => setOpen(false)} />, document.body)}
            <AlertWatcher />
          </WalletCtx.Provider>
        </NetProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
