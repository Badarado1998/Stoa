import Providers from "@/components/Providers";

// pages here need the wallet (wagmi): its code loads only on them, not on every page
export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
