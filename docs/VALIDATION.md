# Paper Route website, version 3: validation record

Worker report, not an independent certification. All runs below were made on the final source and the
export committed with this file (manifest: 1 contract, 10 assets, 1,413,378 bytes).

## Scope

Version 3 changes one thing: the Deliver button. Everything else (Editions picker, Add editions,
Cancel, the Subscribers list, the links, the look, the wording) is unchanged source from version 2.

What Deliver now does (`sendDeliver`, `web/src/actions.ts:66`):

1. Takes at most 25 waiting subscribers (`due()`), simulates `PaperRoute.deliver(issueId, candidates)`
   with `eth_call` **from Multicall3's address** and keeps only the addresses it returns. None:
   nothing is sent, "Nobody can be delivered right now. Nothing was sent."
2. Reads `IMD.balanceOf(Multicall3)` and builds one `Multicall3.aggregate3` with two entries, both
   `allowFailure: false`: `PaperRoute.deliver(issueId, list)` and
   `IMD.transfer(connected wallet, list.length x TIP + IMD Multicall3 already holds)`. `TIP` is read
   from PaperRoute.
3. Simulates that `aggregate3` from the connected wallet. A revert: nothing is sent, "The delivery
   would fail right now, so nothing was sent."
4. Sends it to Multicall3, still asking for 650,000 + 200,000 x addresses gas (`deliverGas`,
   `web/src/config.ts:39`).
5. Waits for the receipt with viem's public client (wagmi's own wait replays a reverted call and
   throws its reason, which hid the status). Reverted: the step reads "reverted" and the `role=alert`
   line says "The delivery transaction reverted. Nothing was delivered and no subscriber was charged;
   only the network fee was spent." Success: counts the `Delivered` logs PaperRoute emitted in that
   receipt and says "Delivered N copies. X IMD in tips was paid to your wallet."

Decisions where the brief was open:

- Multicall3's address comes from viem's own Ethereum chain definition (`multicall3For`,
  `web/src/config.ts:58`), as the ENS resolver already did; it equals the brief's
  `0xcA11bde05977b3631167028862bE2a173976CA11` (checked in the live run below). It is not written
  into `dist/imd-deployment.json`, whose top-level keys are fixed. The page checks it has code on
  load (`deliverReady`, `web/src/data.ts:59`); without it the Deliver button is disabled and a
  warning says so.
- The Deliver note gains one sentence, next to the button, so the wallet's prompt is not a surprise:
  "Your wallet shows a call to Multicall3, which delivers and passes the tips to you in the same
  transaction." "Multicall3" links to its Etherscan page. Button label, Waiting, Tips on offer and
  "Today's edition was delivered at" are unchanged.
- The page re-reads contract state after every delivery attempt, including a reverted one.
- The success message states the tips for the counted copies; IMD that Multicall3 already held is
  swept to the deliverer too but not announced.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` | passed; also runs inside `npm run build` |
| Build + manifest | `cd web && npm run build` | passed; `manifest: 1 contract(s), 10 assets, 1413378 bytes`; ABI canonical keccak equals handoff `abiHash` |
| Manifest audit | scratch script | 10 assets, every SHA-256 matches, no unlisted file; `network` and `walletAddChain` byte-equal to `.imd/reads/network.json`; top-level keys `version, launchId, chainId, sourceCommit, attestationHash, contracts, assets, network, walletAddChain` |
| Interaction test | `cd web && PLAYWRIGHT_BROWSERS_PATH=<browsers> IMD_PLAYWRIGHT=<playwright-core>/index.mjs npm run test:e2e` | **101 passed, 0 failed** |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **16/16 passed** (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share); 390 screenshot inspected: headline, cover, Editions picker and Subscribe on the first screen |
| Em dashes | search of `web/src`, `web/index.html`, `dist/index.html` | none |
| Live read-only replay | scratch scripts with viem against Ethereum mainnet, read calls only | see below |

### Live read-only replay on Ethereum (no transaction sent)

- viem's `mainnet.contracts.multicall3` is `0xca11bde05977b3631167028862be2a173976ca11` and has code.
- The proven Rainbow transaction `0x2ce5ebba…8a66b`: to Multicall3, gas 832,950, success, 2
  `Delivered` events counted the page's way. Rebuilding its call the page's way (issue 23, its 2
  addresses, `transfer(sender, 2 x TIP + balanceOf(Multicall3) at the block before)`) gives
  **byte-identical calldata**.
- The broken transaction `0xb012c07b…82ee`: success, **0** `Delivered` events counted the page's way,
  so the page would have reported it as nothing delivered.
- Replaying the page's steps at block 26,407,381 (just before the proven transaction): `due` = 2;
  `deliver` simulated from Multicall3 returns 2 of 2; the built `aggregate3` simulates without revert
  from the sender with the page's 1,050,000 gas; `eth_estimateGas` for it = 757,009, x 1.1 =
  **832,709** (Rainbow sent 832,950), and the call succeeds at that limit. For contrast a plain
  `deliver` estimates 121,554, and at x 1.1 it **delivers 0 of 2**. The `aggregate3` at 300,000 gas
  reverts with "Multicall3: call failed" instead of delivering nobody.
- Today (issue 23 open, 2 subscribers, nobody due) the live page path cannot be exercised beyond
  "Nobody is waiting".

### What the interaction test asserts (`web/e2e/run.mjs` with `web/e2e/fakechain.mjs`)

The stand-in chain now includes Multicall3 (`aggregate3` runs entries in order as Multicall3, reverts
everything when an `allowFailure: false` entry fails), `IMD.transfer`, a node-style `eth_estimateGas`
(binary search for the lowest gas that does not revert), mined reverted transactions with status
`0x0` and no logs, and three wallet behaviours: keep the page's gas, replace it with a fixed number,
or ignore it and send `eth_estimateGas x 1.1`. PaperRoute's gas rule is modelled as before: a mint is
tried only while 556,000 gas is left, each costs 182,000, below that the address is skipped.

- 6, page's gas: one `aggregate3` to Multicall3 with two entries; entry 1 `PaperRoute.deliver(23,
  [3 addresses])`, entry 2 `IMD.transfer(wallet, 0.085 IMD)` = 3 x 0.025 + 0.01 IMD left in Multicall3
  beforehand, both `allowFailure` false; gas asked 1,250,000; 3 `Delivered` in the receipt; the wallet
  gains 0.085 IMD and Multicall3 ends at 0; "Delivered 3 copies. 0.075 IMD…"; "Today's edition was
  delivered at" links that transaction; the copy appears in the history; the list refreshes.
- 6b, wallet replaces the limit with 200,000: transaction mined reverted, no `Delivered`, no tip, no
  subscriber's editions taken; the step reads "reverted" with its link; `role=alert` "The delivery
  transaction reverted. Nothing was delivered and no subscriber was charged"; waiting re-read as 3.
- 6c, wallet ignores the limit and sends `eth_estimateGas x 1.1` (Rainbow): first the stand-in
  reproduces the bug (a plain `deliver` at its own estimate x 1.1, 89,519 gas, delivers nobody); then
  pressing Deliver sends `aggregate3` that the wallet sends with 1,134,136 gas (its estimate x 1.1, not
  the page's 1,250,000): 3 copies minted, 0.075 IMD reaches the wallet, every subscriber has issue 24,
  "Delivered 3 copies".
- 6d, `deliver` simulated from Multicall3 returns nobody: "Nobody can be delivered right now." and
  no transaction.
- 6e, the `aggregate3` simulation reverts (the tip transfer fails): "The delivery would fail right
  now, so nothing was sent." and no transaction, nobody charged.
- Unchanged and still passing: reads without a wallet, the 1383x968 first screen (headline, cover,
  Subscribe and Deliver, now with the longer note), connect sheet, wrong network with
  `wallet_addEthereumChain` after 4902, Editions picker prices and invalid input, low balance, a
  rejected signature, subscribe (approve then `subscribe(10)`), Add editions (approve 6.25 then
  `subscribe(50)`), Cancel with a 58 x 0.125 IMD refund, Subscribers list (sorting, "you", ENS,
  Show all 62, empty), the 640/800/959 layout, no sideways scroll at 390 and 320 with long values,
  the connect sheet at 320, and no page errors.

## Better Interface review (six domains, changed surfaces)

| Domain | Status | Evidence |
| --- | --- | --- |
| Accessibility | Checked | errors stay `role=alert`, success `role=status`, steps in an `aria-live` region; the reverted state is said in words, not only by the red marker; the new Multicall3 link is a real link with visible text and opens in a new tab like the other external links. Not performed: screen-reader session, 200% zoom, headed keyboard walk |
| Layout | Checked | the longer Deliver note keeps the Deliver button on the 1383x968 first screen (asserted); no sideways scroll at 320/390 (asserted, probe) |
| Writing | Checked | every outcome is one plain sentence saying what happened: nobody deliverable, would fail, reverted with "nothing was delivered and no subscriber was charged", delivered N copies with the tips; the direction about Multicall3 sits next to the button it explains; no em dashes |
| Typography | Checked | no new sizes, weights or faces (probe: type-sizes, type-faces passed) |
| Colors | Checked | reverted reuses the red marker token; no new colors; probe contrast passed |
| UI | Checked | Deliver keeps its single ink button; disabled when the wallet is missing, on the wrong chain, PaperRoute unverified, Multicall3 missing, or a delivery is running |

### Findings and fixes

1. HIGH, `web/src/actions.ts:66` (was a plain `deliver` with the page's gas): a wallet that drops the
   page's limit delivered nobody. Fixed with the Multicall3 `aggregate3`; rechecked by test 6c and the
   live replay.
2. HIGH, `web/src/actions.ts:101`: wagmi's `waitForTransactionReceipt` threw "Missing or invalid
   parameters" (its replay of the reverted call) instead of returning the reverted status, so the
   page could not say "nothing was delivered". Fixed by reading the receipt with viem's public client;
   rechecked by test 6b.
3. MEDIUM, `web/src/App.tsx:93` / `web/src/tx.ts`: a reverted delivery left its step reading
   "pending". Added a "reverted" step state with the red marker.
4. LOW, `web/src/App.tsx:371`: the wallet's prompt names Multicall3, which the page never mentioned.
   Added one sentence beside the button with an Etherscan link for the contract.

## Untested and limitations

- No transaction was broadcast. The Multicall3 path ran against the in-memory stand-in and as
  read-only `eth_call`/`eth_estimateGas` replays on mainnet state; real wallet UIs (Rainbow, MetaMask,
  Rabby, Coinbase Smart Wallet) were not driven. The proven mainnet transaction is the brief's.
- Today nobody is due on mainnet, so the page's live Deliver path was only seen up to "Nobody is
  waiting for today's edition."
- Public RPCs in `network.rpcUrls` were not called from this machine; reads went to the stand-in or,
  for the replay, to this machine's read-only Ethereum endpoint.
- The browser MCP preview was not used; rendered checks ran in headless Chromium scripts.
  Screenshots stayed in `test/scratch/` and are not delivered.
- og:image is the relative `./og.png`; absolute Open Graph URLs await the published domain.

## Completion

Complete for the stated scope, with the limitations above (no live transaction, no real wallet UI).
