# Paper Route website, version 2: validation record

Worker report, not an independent certification. All runs below were made on the final source and the
export committed with this file (manifest: 1 contract, 10 assets, about 1.4 MB).

## Scope and assumptions

Version 2 changes five things on the existing page and keeps the rest:

1. Editions picker: quick picks 5, 10, 50, 500 and a field for 1 to 1,000,000; 10 on load. The
   button names `N x EDITION_PRICE` (read from the contract) exactly; it approves that amount when the
   allowance is short and calls `subscribe(N)`, batched with `wallet_sendCalls` where supported, else
   two transactions. Subscribers get "Add editions" (same picker, "Add N for X IMD") and "Cancel and
   refund N IMD". The short-balance line shows only while a picker is open.
2. Deliver: gas limit `650,000 + 200,000 x addresses` set by the page (`deliverGas`,
   `web/src/config.ts:39`); simulation from the connected address with
   that limit; only simulated-delivered addresses are sent; the message counts the `Delivered`
   events PaperRoute emitted in the receipt (`web/src/actions.ts:73`), and zero
   is an error: "Nothing was delivered and no tip was paid."
3. Subscribers section, read without a wallet: `subscriberCount`, `subscribers(offset, 200)`,
   `editionsLeft` and `lastDeliveredAt` per address (JSON-RPC batched, 25 a request),
   `reservedEditions`; ENS reverse names load afterwards for the shown rows only. Refreshes on the
   20 s poll and after subscribe, cancel and deliver.
4. Middle width (640 to 959px): Subscribe under the headline beside the cover.
5. Links to The IMD Daily's site and https://x.com/theimddaily under the cover and in the footer.

Decisions taken where the brief was open: the heading reads "Subscribers: N"; ties in editions left
keep contract order; the picker keeps the visitor's last pick after a subscribe or cancel; an invalid
field shows "Enter a whole number of editions, from 1 to 1,000,000."; the "What the X IMD pays for"
line is hidden while prices load or the field is invalid. ENS names use viem's built-in Ethereum
universal resolver (only on chain 1), the one address not taken from the manifest; the site still
holds no address of its own. The share image `og.png` was regenerated because it named "5 IMD" and
"40 editions". `DESIGN.md` moved from `docs/` to the repository root.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` | passed (no output); also runs inside `npm run build` |
| Build + manifest | `cd web && npm run build` | passed; `manifest: 1 contract(s), 10 assets, 1411098 bytes`; ABI canonical keccak equals handoff `abiHash` |
| Interaction test | `cd web && IMD_PLAYWRIGHT=<playwright-core>/index.mjs CHROMIUM=<chrome-headless-shell> npm run test:e2e` | **89 passed, 0 failed** |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | **16/16 passed** (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share) |
| Live read-only check | scratch script: export in headless Chromium, public-RPC calls forwarded to this machine's read-only mainnet endpoint | 1383x968, 800x1000, 390x844, 320x640: "Subscribe for 1.25 IMD", "Subscribers: 0 / Nobody is subscribed yet." (live `subscriberCount` 0, `reservedEditions` 0), Deliver shows issue #24 on sale, no sideways scroll, no page errors. Direct reads: `getEnsName(0xd8dA…6045)` = `vitalik.eth` through the configured resolver; `simulateContract deliver(24, [])` with `gas: 650000` returns `[]` |

### What the interaction test asserts (`web/e2e/run.mjs` with `web/e2e/fakechain.mjs`)

The stand-in PaperRoute now behaves like the real one on gas: a mint is tried only while 556,000 gas
is left, each delivery uses 182,000, and below that the address is skipped without reverting; receipts
carry the emitted `Delivered` logs; a wallet left without a gas field uses its own 200,000 estimate.

- Reads without a wallet: real cover URL, cover link, "Read the paper"/"@theimddaily" under the cover
  and "The paper itself: The IMD Daily · @theimddaily" right after the disclaimer, all `target=_blank`;
  new dek and How it works line; no em dash in the page text.
- Picker: 10 pressed on load, "Subscribe for 1.25 IMD", "10 editions, one a day.", "What the 1.25
  IMD pays for"; 500 gives "Subscribe for 62.5 IMD" and "50 IMD buys 500 copies… 12.5 IMD tips"; typed 7
  gives 0.875 IMD; 1,000,000 gives 125,000 IMD; "", 0, 1.5, abc, 1000001 and -3 each disable the
  button with the one line.
- Subscribers: "Subscribers: 2", "80 editions prepaid in total.", ENS name shown after rows, short
  address otherwise, Etherscan links, "none yet"; after subscribing "Subscribers: 3", own row "you",
  order 40, 40, 10; after delivery the dates replace "none yet"; after cancel back to 2; 62
  subscribers show 50 rows, largest first, "Show all 62" reveals 62; empty list shows "Nobody is
  subscribed yet." and "Subscribers: 0".
- Headline, cover, Subscribe and Deliver inside 1383x968; connect sheet, wrong network,
  `wallet_addEthereumChain` with `walletAddChain` unchanged after 4902.
- Balance 1 IMD: 10 editions disabled with "This needs 1.25 IMD. Your wallet holds 1 IMD.", 5
  editions enabled. Rejected signature sends nothing.
- Subscribe sends `approve(PaperRoute, 1.25 IMD)` then `subscribe(10)`.
- Deliver sends `deliver(23, [3 addresses])` with gas 1,250,000, pays 3 x 0.025 IMD, says
  "Delivered 3 copies. 0.075 IMD…", then "Today's edition was delivered at" linking the transaction.
- **Gas case**: next issue, the wallet replaces the page's 1,250,000 with 200,000: the transaction
  succeeds, emits no `Delivered`, pays no tip, and the page shows the `role=alert` error "Nothing was
  delivered and no tip was paid."; the waiting count is re-read as 3.
- Simulation delivering nobody (every mint fails while `due()` still lists them): "Nobody can be
  delivered right now." and no transaction sent.
- Add editions with 1 IMD: no balance line under the read-only subscription; the line and a disabled
  "Add 10 for 1.25 IMD" appear while the picker is open and disappear on Close; with funds, picking 50
  sends approve 6.25 IMD + `subscribe(50)`. Cancel asks first and refunds 59 x 0.125 = 7.375 IMD.
- 640, 800 and 959px: Subscribe starts directly under the headline, left of and beside the cover;
  Deliver and Subscribers below at full width; no sideways scroll.
- 390 and 320 with a 123,456,789,012 IMD balance, 62 subscribers and a 55-character ENS name: no
  sideways scroll; Subscribe button, wallet button and cover on the 390x844 first screen; the connect
  sheet fits at 320; no page errors.

## Better Interface review (six domains, changed surfaces)

| Domain | Status | Evidence |
| --- | --- | --- |
| Accessibility | Checked | picker is a `fieldset`/`legend`, quick picks are native buttons with `aria-pressed`, the field has a label, `aria-invalid` and `aria-describedby` to a `role=alert` line; 44px picks and buttons, 24px link targets; table with `th scope=col`; zero-delivery result is `role=alert`. Not performed: screen-reader session, native 200% zoom, headed keyboard walk |
| Layout | Checked | middle width fixed (asserted at 640/800/959, screenshot at 800); first screen at 390 and 1383x968 asserted; table capped at 760px after the 1383 screenshot showed numbers far from addresses |
| Writing | Checked | button names the exact price; one line per problem (invalid field, short balance, nobody deliverable, nothing delivered) saying what happened and what to do; no em dashes |
| Typography | Checked | still 2 families, 2 weights, 4 sizes per width (probe); mono tabular figures in picks, counts and table |
| Colors | Checked | pressed pick uses ink, invalid uses the red token; probe contrast passed |
| UI | Checked | picks/field share the square newsprint button language; rest/hover/pressed/focus/disabled states; reduced motion removes the pick transition |

### Findings and fixes

1. HIGH, `web/src/App.tsx:324` (was the old `sendOne` deliver): the page
   reported the simulation's result as a delivery and let the wallet pick the gas. Fixed as in item 2
   above; rechecked by test steps 6, 6b and 6c.
2. MEDIUM, `web/src/styles.css` `.front` at 640 to 959px: blank block under the headline beside the
   cover. Fixed with the `lead cover / subscribe cover` areas; rechecked at three widths.
3. MEDIUM, `web/public/og.png`: share image still said "Pay 5 IMD once. 40 editions". Regenerated.
4. LOW, `.subs` table at 1383px: editions column about 850px from the address. Capped at 760px.
5. LOW, `web/src/App.tsx:274`: while prices loaded the summary
   read "What the … IMD pays for" (probe 390 screenshot). Now hidden until the price is read.

## Untested and limitations

- No real transaction was broadcast: subscribe, add, cancel and deliver ran only against the
  in-memory stand-in and a test wallet. The gas behaviour of the stand-in is a model of the measured
  fork numbers in the brief, not PaperRoute's bytecode. Real wallet UIs (MetaMask, Rabby, Coinbase
  Smart Wallet), whether a given wallet keeps the page's gas limit, and the `wallet_sendCalls` path
  were not exercised.
- The live list was empty on mainnet (0 subscribers), so populated rows and ENS names on the page
  were only seen with the stand-in; ENS resolution itself was checked live for one address.
- Public RPCs in `network.rpcUrls` were not called from this machine, so their acceptance of JSON-RPC
  batches (25 calls each) is untested; viem's fallback transport moves to the next URL on failure.
- In the live run this sandbox blocked the browser from the cover image host, so the real cover image
  did not render there (the previous job's live run loaded it); the cover element and caption did.
- The browser MCP preview was not used; rendered checks ran in headless Chromium scripts. Screenshots
  stayed in `test/scratch/` and are not delivered.
- og:image is the relative `./og.png`; absolute Open Graph URLs await the published gateway or domain.

## Completion

Complete for the stated scope, with the limitations above (no live transaction, no real wallet UI).
