"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import WalletModal from "./WalletModal";

const WalletCtx = createContext<{ open: () => void }>({ open: () => {} });
export const useWalletModal = () => useContext(WalletCtx);

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  const [open, setOpen] = useState(false);
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <WalletCtx.Provider value={{ open: () => setOpen(true) }}>
          {children}
          <WalletModal open={open} onClose={() => setOpen(false)} />
        </WalletCtx.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
