import { createConfig, http, fallback } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { elysium, RPCS } from "./chain";

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
  transports: { [elysium.id]: RPCS.length ? fallback(RPCS.map((u) => http(u, { batch: true })), { rank: false, retryCount: 1 }) : http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
