# Paper Route design

Documents the final source of version 2 (`web/src/styles.css`, `web/src/App.tsx`, `web/src/wallet.tsx`).

## Overview

A single dense front page for readers of The IMD Daily and for anyone who wants to earn delivery
tips. The look is newsprint: off-white paper, black ink, one red accent, serif headlines, mono for
numbers and addresses, thin rules between columns. No gradients, no rounded card grid, no small
capital labels, no shadows. At desktop width the headline, the live cover, Subscribe and Deliver sit
on one 1383x968 screen like a broadsheet front page, with the Subscribers list below; on a phone the
cover becomes a thumbnail beside the headline so the Editions picker and Subscribe button stay on the
first screen.

## Colors (`web/src/styles.css`, `:root`)

| Token | Value | Job |
| --- | --- | --- |
| `--paper` | `#f5f1e6` | page background, text on ink fills |
| `--paper-2` | `#ebe5d5` | hover fill, cover frame, the connected wallet's own Subscribers row |
| `--ink` | `#141414` | text, primary rules, ink button fill, the picked quick pick, focus ring |
| `--ink-2` | `#4a4740` | secondary text (notes, captions, table headings, legend) |
| `--rule` | `#141414` | column and section rules |
| `--rule-soft` | `#c9c1ad` | quiet button and quick-pick borders, table row rules, step markers |
| `--red` | `#b3141c` | the one accent: masthead rule, Subscribe/Add fill, warnings, errors, invalid field |
| `--red-press` | `#8e0f16` | red button hover |
| `--ok` | `#1d5e2a` | confirmed transaction text and step marker |
| (literal) | `#fffdf7` | Editions number field fill, so the field reads as editable |

Red fills exactly one action per panel (Subscribe, Add editions or Add N for X IMD). Deliver uses an
ink fill. The design probe measured every rendered text pair at or above 4.5:1.

## Typography

- Families: `--serif` Georgia, "Times New Roman", Times, serif (everything); `--mono` ui-monospace,
  SFMono-Regular, Menlo, Consolas, monospace (addresses, counts, quick picks, the Editions field,
  stats; `tabular-nums`). System fonts only; nothing is downloaded.
- Sizes: `--fs-small` 13px (notes, captions, footer, table, quick picks), `--fs-body` 15px (body,
  buttons, Editions field), `--fs-lead` 18px (dek, h2, wordmark, stats), `--fs-head`
  `clamp(30px, 2.4vw + 20px, 56px)` (h1, editions-left number). Four sizes per width.
- Weights: 400 and 700. 700 only for h1, h2, h3, the wordmark and the footer disclaimer; the h1 is the
  largest and heaviest text. h1 `letter-spacing: -0.02em`, `line-height: 1.04`, `text-wrap: balance`.
- Body line height 1.5; notes 1.45; dek capped at 34ch, the pays-for paragraph at 60ch.

## Layout and responsive behavior

- `.page`: max 1320px, 16px side padding. Spacing scale `--space-1..6` = 4, 8, 12, 16, 24, 32px.
- `.front` grid, mobile first (under 640px): `minmax(0,1fr) 112px`, areas
  `lead cover / subscribe subscribe / deliver deliver / subs subs`.
- Middle width, 640 to 959px: `minmax(0,1fr) 220px`, areas
  `lead cover / subscribe cover / deliver deliver / subs subs`, rows `auto 1fr`. Subscribe sits
  directly under the headline in the left column beside the cover (1px ink rule on the cover's left),
  so no blank block is left under the headline; Deliver and Subscribers follow at full width.
- From 960px: three columns `1.1fr 0.8fr 1fr`, areas
  `lead cover deliver / subscribe cover deliver / subs subs subs`, ink rules either side of the cover
  column, cover capped at 62vh.
- `.panel`: top rule, 16px vertical padding, 12px gap. Long values wrap (`overflow-wrap: anywhere` on
  notes, steps, the footer address and Subscribers names), so nothing scrolls sideways at 320px.
- Subscribers table: full width up to 760px so an address stays near its numbers on wide screens.
- Footer: disclaimer, "The paper itself:" line, address row (checksummed address, Copy, Etherscan,
  Source), four-line "How it works", explorer links for IMD and The IMD Daily.

## Elevation and depth

Deliberately flat: no shadows. Structure comes from 1px rules and the 4px red masthead rule. The
connect sheet sits over a 45% ink backdrop.

## Components (`web/src`)

- `.btn` (44px min height, square corners, 150ms color transitions, disabled at 45% opacity) with
  variants `.btn-red` (main action), `.btn-ink` (Connect, Deliver, Yes cancel), `.btn-quiet` (soft
  border: Disconnect, Cancel and refund, Close, Copy, Show all), `.btn-small` (32px), `.btn-main`
  (full width). States: rest, hover, active, `:focus-visible` 2px ink ring offset 2px.
- `EditionsPicker` (`web/src/App.tsx:115`): a `fieldset` with legend
  "Editions"; four quick picks (5, 10, 50, 500) as native buttons with `aria-pressed` (pressed = ink
  fill), 48px wide and 44px tall; a labelled text field (`inputMode=numeric`) for any whole number
  from 1 to 1,000,000. Invalid input sets `aria-invalid`, a red field border and one `role=alert` line.
  10 is picked on load; the pick drives the button price, the "N editions, one a day." line and the
  "What the X IMD pays for" disclosure at once.
- Subscription view: editions-left figure, delivered covers, "Add editions" (opens the same picker
  with "Add N for X IMD" and Close) and "Cancel and refund N IMD" with an inline confirmation.
- `Subscribers` (`web/src/App.tsx:378`): heading "Subscribers: N", one line
  of total editions prepaid, a compact table (short address or ENS name linking to Etherscan, a
  bordered "you" tag on the connected wallet's row and a `--paper-2` row fill, editions left right
  aligned in mono, last delivered date or "none yet"), first 50 rows then "Show all N".
- `WalletControl` / `ConnectSheet` (`wallet.tsx`): one control; Connect, short address with
  Disconnect, or "Switch to Ethereum". Bottom sheet under 640px, centered above, focus trap, Escape.
- `TxStatus`: ordered steps with left markers (red pending, green confirmed), explorer links, and a
  result line (`role=status`, or `role=alert` for errors such as "Nothing was delivered").
- `Cover`: linked real cover with caption (title, sale window), then `.paper-links`: "Read the paper"
  and "@theimddaily", both opening in a new tab.

## Do and don't

- Do read every number from the contracts; prices use `exact()` in `format.ts` (bigint, no rounding,
  trailing zeros dropped), balances use `amount()`.
- Do keep red for one action per panel and for errors.
- Don't add shadows, rounded cards, gradients, all-caps labels, em dashes or placeholder art.
