# Paper Route: website

One static page for PaperRoute (`0xfa530b7f1557f944b7f028d0a0cc0505ece84b61`, Ethereum mainnet):
subscribe for 5 IMD, see and manage your subscription, and deliver today's edition of The IMD Daily.
Unofficial. Not run by The IMD Daily. Vite + React + TypeScript, wagmi/viem. No backend, no trackers.

## Configuration (one place)

- **Runtime deployment config:** `dist/imd-deployment.json`. The page fetches it on load (relative
  URL) and then the ABI it names (`dist/abi/PaperRoute.json`). Chain id, PaperRoute address, ABI,
  public RPC URLs (`network.rpcUrls`), explorer and `walletAddChain` all come from it. The IMD
  token and The IMD Daily addresses are read from PaperRoute's own `IMD()` and `DAILY()`.
- **Build input:** `web/deployment/handoff.json` and `web/deployment/network.json` are byte copies
  of the deployment handoff and the network's chain table entry. `web/scripts/manifest.mjs` copies
  `docs/abi/PaperRoute.json`, checks its canonical Keccak hash (`web/scripts/canonical.mjs`) against
  the handoff `abiHash`, and writes the manifest with SHA-256 hashes of every exported file.
- **Site constants:** `web/src/config.ts` (site copy, The IMD Daily's site URL, source repo, the brief's
  40 editions and 25-address batch, the deployment block used as the event-scan start, standard
  ERC-20/ERC-1155 view fragments). No private RPC, key or WalletConnect project ID exists.
- Wallets: EIP-6963 browser wallets, Coinbase Wallet / Smart Wallet (telemetry off), and on phones
  "Open in MetaMask / Coinbase Wallet / Phantom" links (`web/src/open-in.ts`). No relay.

## Install, build, preview

```sh
cd web
npm ci                 # installs from package-lock.json
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + vite build to ../dist + manifest (rewrites dist/imd-deployment.json)
npm run preview        # serves ../dist locally
```

`vite.config.ts` uses `base: "./"`, so `dist/` works from any IPFS gateway path or ENS name with no
rewrites. Rebuild after every source change: the manifest hashes must match the committed export.

## Validation

`npm run test:e2e` (= `node e2e/run.mjs [screenshotDir]`) drives the built `dist/` in headless
Chromium. Set `IMD_PLAYWRIGHT` to a `playwright-core` `index.mjs` (Playwright is not a dependency of
the site) and, if needed, `CHROMIUM` to a browser binary. Public-RPC requests are answered by
`e2e/fakechain.mjs`, an in-memory PaperRoute/IMD/IMD Daily stand-in, and an EIP-6963 test wallet is
injected. It covers reads without a wallet, the connect sheet, wrong network with
`wallet_addEthereumChain` fallback, low balance, a rejected signature, subscribe (approve 5 IMD then
`subscribe(40)`), deliver, add 40 more, cancel with refund, and overflow at 390 and 320 px.
Results and limitations: `docs/VALIDATION.md`. Design system: `docs/DESIGN.md`.

## Delivery bot

PaperRoute's own README describes the bot (read `issueCount` and `due`, simulate `deliver`, send).
The page does the same for one press: up to 25 due subscribers per transaction.
