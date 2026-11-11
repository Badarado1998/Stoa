import { createConfig, http, fallback } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { elysium } from "./chain";

const wc = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [elysium],
  multiInjectedProviderDiscovery: true, // MetaMask, Rabby, OKX ... announce themselves (EIP-6963)
  connectors: [
    injected({ shimDisconnect: true }),
    ...(wc
      ? [walletConnect({ projectId: wc, showQrModal: true, metadata: { name: "Stoa", description: "The PropAMM hub on Elysium", url: "https://stoa.trade", icons: ["https://stoa.trade/logo.png"] } })]
      : []),
  ],
  transports: { [elysium.id]: elysium.rpcUrls.default.http[0] ? fallback([http(elysium.rpcUrls.default.http[0])]) : http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
