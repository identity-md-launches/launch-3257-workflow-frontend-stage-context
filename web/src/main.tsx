import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, fallback, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { loadDeployment, SITE_NAME } from "./config";
import { DeploymentContext } from "./deployment";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

loadDeployment()
  .then((dep) => {
    // Wallet connection the network's one way: EIP-6963 extensions, Coinbase Smart Wallet, and on
    // phones the "Open in" links. No relay, no project ID. Reads go to the manifest's public RPCs.
    const wagmi = createConfig({
      chains: [dep.chain],
      multiInjectedProviderDiscovery: true,
      connectors: [injected(), coinbaseWallet({ appName: SITE_NAME, preference: { options: "all", telemetry: false } })],
      transports: { [dep.chain.id]: fallback(dep.file.network.rpcUrls.map((u) => http(u))) },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } });
    root.render(
      <StrictMode>
        <DeploymentContext.Provider value={dep}>
          <WagmiProvider config={wagmi}>
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </WagmiProvider>
        </DeploymentContext.Provider>
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    root.render(
      <main className="page fatal">
        <h1>Paper Route</h1>
        <p role="alert">The page could not load its deployment configuration. {e instanceof Error ? e.message : String(e)}</p>
      </main>,
    );
  });
