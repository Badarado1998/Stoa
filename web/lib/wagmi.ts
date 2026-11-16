import { createConfig, http, fallback } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { elysium, RPCS } from "./chain";
import { robinhood } from "./networks";

const wc = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
// JSON-RPC batching per endpoint: dRPC's free plan rejects batches of more than 3 calls
const rpc = (u: string) => http(u, { batch: /drpc\./.test(u) ? { batchSize: 3 } : true });
const rhRpcs = robinhood.rpcUrls.default.http;

export const wagmiConfig = createConfig({
  chains: [robinhood, elysium], // the first is the default a WalletConnect session asks for
  multiInjectedProviderDiscovery: true, // MetaMask, Rabby, OKX ... announce themselves (EIP-6963)
  connectors: [
    injected({ shimDisconnect: true }),
    ...(wc
      ? [walletConnect({ projectId: wc, showQrModal: true, metadata: { name: "Stoa", description: "Swap router on Robinhood Chain and Elysium", url: "https://stoadex.com", icons: ["https://stoadex.com/logo.png"] } })]
      : []),
  ],
  transports: {
    [elysium.id]: RPCS.length ? fallback(RPCS.map(rpc), { rank: false, retryCount: 1 }) : http(),
    [robinhood.id]: fallback(rhRpcs.map(rpc), { rank: false, retryCount: 1 }),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
