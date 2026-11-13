# Paper Route website: validation record

Worker report, not an independent certification. All runs below were made on the final source and
export committed with this file (manifest: 1 contract, 10 assets, about 1.4 MB).

## Scope and assumptions

- One page (`dist/index.html`), hash-free single route, `base: "./"`. Flows: read without a wallet,
  connect, wrong network, subscribe (approve 5 IMD + `subscribe(40)`), your subscription (editions
  left, delivered covers, add 40 more, cancel and refund), deliver the open issue (at most 25 due
  addresses a transaction), footer.
- The "open issue" is the latest issue (`issueCount()`) when `isAvailable` is true; the waiting list
  is `due(issue, offset, 200)` paged over `subscriberCount()`.
- Batching: when `wallet_getCapabilities` reports atomic support the page sends approve + subscribe
  with `wallet_sendCalls` (one confirmation); otherwise two transactions, approve only when the
  allowance is short. Each single transaction is simulated before the wallet is asked.
- Cancel asks for an inline confirmation first (`web/src/App.tsx:169`), since it ends deliveries.
- No token, pool or swap is part of this launch: the Uniswap addresses in `network` are copied into
  the manifest unchanged and no swap, quote or Permit2 flow exists (none is requested).
- `DESIGN.md` is at `docs/DESIGN.md`: the repository root is outside this assignment's write scope.
- "Open in Rabby" is not listed: the pinned wallet reference names a Rabby link form but does not
  give it, and inventing one was not acceptable. MetaMask, Coinbase Wallet and Phantom links are listed.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` | passed (no output); also runs inside `npm run build` |
| Build + manifest | `cd web && npm run build` | passed; `manifest: 1 contract(s), 10 assets` |
| ABI hash | `web/scripts/manifest.mjs` (fails the build on mismatch) | canonical keccak `7fed2935…e080` = handoff `abiHash`; `docs/abi/PaperRoute.json` identical to the pinned commit `4102dde` |
| Manifest audit | inline Node check of `dist/imd-deployment.json` | keys exactly version, launchId, chainId, sourceCommit, attestationHash, contracts, assets, network, walletAddChain (handoff has no poolKey); ids, contract set and abiHash match; network and walletAddChain byte-equal to network.json; all 10 SHA-256 hashes verify |
| Interaction test | `node web/e2e/run.mjs` with `IMD_PLAYWRIGHT` set (playwright-core 1.58 with the machine's Chromium 1248 headless shell) | **38 passed, 0 failed** |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **16/16 passed** (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share) |
| Live read-only check | scratch script: built export in Chromium, public-RPC calls forwarded to this machine's read-only mainnet endpoint, covers fetched for real | 1383x968 and 390x844: real cover of "The IMD Daily \| Issue #24 \| November 13, 2026" loaded (1240x1754), sale window shown, Subscribe and Deliver panels rendered from live state (0 subscribers), no horizontal overflow, no page errors |

The interaction test (`web/e2e/run.mjs`, `web/e2e/fakechain.mjs`) asserts, against the built export:
reads without a wallet (cover URL from `getIssue`, link to The IMD Daily's site, waiting count and
"Deliver today's edition and earn 0.05 IMD", footer disclaimer and checksummed address); headline,
cover, Subscribe and Deliver inside 1383x968; the connect sheet lists the EIP-6963 wallet by name and
Coinbase Wallet, never "Injected", closes on Escape; on chain 0x5 Subscribe is disabled, "Switch to
Ethereum" gets 4902 and then sends `wallet_addEthereumChain` with `walletAddChain` unchanged; low
balance disables Subscribe with the amounts; reconnect after reload; a rejected signature shows "You
declined the request in your wallet. Nothing was sent." and sends nothing; subscribe sends
`approve(PaperRoute, 5e18)` on IMD then `subscribe(40)` with Etherscan links; deliver sends
`deliver(23, [3 due])`, pays 3 x 0.025 IMD, then shows "Today's edition was delivered at …" linking
the transaction and the delivered cover with its date; Add 40 more sends approve + `subscribe(40)`;
cancel asks first, sends `cancel()`, refunds 79 x 0.125 IMD, history remains; no horizontal scroll at
390 and 320 with a 123,456,789,012 IMD balance; Subscribe, wallet button and cover on the 390x844
first screen; the sheet fits at 320; no page errors.

## Better Interface review (six domains)

| Domain | Status | Evidence |
| --- | --- | --- |
| Accessibility | Checked | native buttons/links/details; visible `:focus-visible` ring; dialog with `aria-modal`, focus trap (`web/src/wallet.tsx:103`), Escape, focus return; `aria-live` transaction status, `role=alert` errors; alt text on covers; 44px buttons, 48px sheet rows; reduced motion removes transitions. Not performed: screen-reader session, native 200% zoom, keyboard walk in a headed browser |
| Layout | Checked | broadsheet grid, product and main action on first screen at 390 and 1383x968 (asserted); no sideways scroll at 320/390/1440 (probe + test) |
| Writing | Checked | verb-first labels from the brief; errors say what happened and what to do; amounts from the contract; no em dashes (probe) |
| Typography | Checked | 2 families, 2 weights, 4 sizes per width (probe); tabular mono numbers; balanced headline |
| Colors | Checked | one red accent, tokens in `:root`; probe measured all rendered text at or above 4.5:1 |
| UI | Checked | flat surfaces, square buttons with rest/hover/active/focus/disabled states, no `transition: all` |

### Findings and fixes

1. MEDIUM, `web/src/wallet.tsx:76`: the connected wallet button wrapped "0x7099…79C8 · Disconnect"
   onto two lines (the column-flex wrapper class was reused on the button). Seen in the 1383 and 390
   screenshots. Fixed with a separate `.wallet-btn` (`white-space: nowrap`); rechecked by rerun.
2. HIGH, `web/src/data.ts:105`: after a delivery the page could not find its own Delivered event,
   because viem's cached block number capped the log scan below the new block; "today's edition was
   delivered" and the delivered covers never appeared. Fixed: `cacheTime: 0` and the last window
   scans to `latest`. Rechecked: test steps 6 and 8 pass.
3. HIGH, `web/src/main.tsx:20`: the Coinbase Wallet SDK injected a telemetry script, against the
   brief's "no trackers". Fixed with `preference.telemetry: false`; the console error disappeared.
4. MEDIUM, `web/src/data.ts:136` and `web/src/App.tsx:260`: the live endpoint refused wide
   `eth_getLogs` ranges (10-block cap upstream). Delivered-copy history now falls back to one ERC-1155
   `balanceOfBatch` read (labelled as such), and the delivered line says the time could not be read
   instead of spinning.

## Untested and limitations

- No real transaction was broadcast: subscribe, deliver, add and cancel were exercised only against
  the in-memory stand-in and a test wallet. Real wallet UIs (MetaMask, Rabby, Coinbase Smart Wallet,
  the mobile "Open in" links) and the `wallet_sendCalls` batch path were not exercised.
- Public RPCs from `network.rpcUrls` were not called from this machine; reads were checked through
  this machine's read-only mainnet endpoint. If a public RPC refuses wide `eth_getLogs` ranges, the
  delivery time of today's edition is not shown (history still shows through the fallback).
- The design probe's own browser could not reach the RPCs, so it measured the page in its loading
  state; the populated layout was measured by the interaction test and the live read-only check.
- og:image is a relative `./og.png`; absolute Open Graph URLs await the published gateway/domain.
- The browser MCP preview (`test/scratch/browser/preview.json`) did not exist on this machine;
  rendered checks used headless Chromium scripts instead. Screenshots stayed in `test/scratch/`.

## Completion

Complete for the stated scope, with the limitations above (no live transaction, no real wallet UI).
