# Paper Route: website

One static page for PaperRoute (`0xfa530b7f1557f944b7f028d0a0cc0505ece84b61`, Ethereum mainnet):
subscribe for any number of editions (quick picks 5, 10, 50, 500 or any whole number), see and manage
your subscription, deliver today's edition of The IMD Daily, and see every subscriber.
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
- **Site constants:** `web/src/config.ts` (site copy, The IMD Daily's site and X links, source repo,
  the editions quick picks, default 10 and 1,000,000 cap, the 25-address batch, the deliver gas rule, Multicall3 and its `aggregate3` fragment,
  50 visible subscriber rows, the deployment block used as the event-scan start, standard
  ERC-20/ERC-1155 view fragments). ENS names use viem's built-in Ethereum universal resolver. No private RPC, key or WalletConnect project ID exists.
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

## Why Deliver goes through Multicall3

PaperRoute skips a mint without reverting when too little gas is left, so a wallet that replaces the
page's gas limit with its own estimate (Rainbow sends `eth_estimateGas` x 1.1) sent transactions that
succeeded and delivered nobody. Sending `deliver` through Multicall3's `aggregate3` together with an
IMD transfer of the tips to the deliverer makes too little gas revert instead, so a wallet's own
estimate now covers every mint.

The page simulates `deliver` from Multicall3's address and lists only the addresses it returns,
simulates the whole `aggregate3` from the connected wallet, still asks for 650,000 gas plus 200,000
per address, and reports the `Delivered` events in the receipt; a reverted transaction is reported as
nothing delivered. Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) comes from viem's
Ethereum chain definition (`multicall3For` in `web/src/config.ts`) and is checked for code on load.

## Validation

`npm run test:e2e` (= `node e2e/run.mjs [screenshotDir]`) drives the built `dist/` in headless
Chromium. Set `IMD_PLAYWRIGHT` to a `playwright-core` `index.mjs` (Playwright is not a dependency of
the site) and, if needed, `CHROMIUM` to a browser binary. Public-RPC requests are answered by
`e2e/fakechain.mjs`, an in-memory PaperRoute/IMD/IMD Daily/Multicall3 stand-in (with a node-style binary-search
`eth_estimateGas` and reverted receipts), and an EIP-6963 test wallet is
injected. It covers reads without a wallet, the connect sheet, wrong network with
`wallet_addEthereumChain` fallback, the Editions picker (prices, invalid input), low balance, a
rejected signature, subscribe (approve 1.25 IMD then `subscribe(10)`), deliver through Multicall3
(`aggregate3` with `deliver` and the IMD tip transfer, both `allowFailure` false, including IMD
already held by Multicall3), a wallet that replaces the limit with too little (reverts, reported as
nothing delivered), a wallet that ignores the limit and sends `eth_estimateGas` x 1.1 (copies minted,
tips paid), a simulation that delivers nobody, an `aggregate3` simulation that reverts, add editions, cancel with refund, the Subscribers list (sorting,
"you", ENS, Show all, empty), the 640 to 959 px layout, and overflow at 390 and 320 px.
Results and limitations: `docs/VALIDATION.md`. Design system: `DESIGN.md` at the repository root.

## Delivery bot

PaperRoute's own README describes the bot (read `issueCount` and `due`, simulate `deliver`, send).
The page does the same for one press, through Multicall3: up to 25 due subscribers per transaction.
