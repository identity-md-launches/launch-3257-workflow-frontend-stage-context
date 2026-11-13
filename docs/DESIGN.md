# Paper Route design

Placed at `docs/DESIGN.md` because this assignment may only write `web/**`, `dist/**` and `docs/**`;
the criterion asked for a repository-root `DESIGN.md`, which is outside that write scope.

## Overview

A single dense front page for readers of The IMD Daily and for anyone who wants to earn delivery
tips. The look is newsprint, as the brief asks: off-white paper, black ink, one red accent, serif
headlines, mono for numbers and addresses, thin rules between columns. No gradients, no rounded card
grid, no small capital labels, no shadows. At desktop width the headline, the live cover, Subscribe
and Deliver sit on one screen like a broadsheet's front page; on a phone the cover becomes a
thumbnail beside the headline so the Subscribe button stays on the first screen.

## Colors (`web/src/styles.css`, `:root`)

| Token | Value | Job |
| --- | --- | --- |
| `--paper` | `#f5f1e6` | page background, text on ink buttons |
| `--paper-2` | `#ebe5d5` | hover fill, cover frame background |
| `--ink` | `#141414` | text, primary rules, ink button fill, focus ring |
| `--ink-2` | `#4a4740` | secondary text (notes, captions) |
| `--rule` | `#141414` | column and section rules |
| `--rule-soft` | `#c9c1ad` | quiet button borders, step markers, thumbnails |
| `--red` | `#b3141c` | the one accent: masthead top rule, Subscribe/Add button fill, warnings and errors |
| `--red-press` | `#8e0f16` | red button hover |
| `--ok` | `#1d5e2a` | confirmed transaction text and step marker |

Red fills exactly one action per panel (Subscribe or Add 40 more). Deliver uses an ink fill. The
taste probe measured all rendered text pairs at or above 4.5:1 (see `docs/VALIDATION.md`).

## Typography

- Families: `--serif` Georgia, "Times New Roman", Times, serif (everything); `--mono` ui-monospace,
  SFMono-Regular, Menlo, Consolas, monospace (addresses, counts, IMD amounts in stats, with
  `tabular-nums`). System fonts only; nothing is downloaded.
- Sizes: `--fs-small` 13px (notes, captions, footer), `--fs-body` 15px (body, buttons), `--fs-lead`
  18px (dek, h2, wordmark, stats), `--fs-head` `clamp(30px, 2.4vw + 20px, 56px)` (h1, editions-left
  number). Four sizes per width.
- Weights: 400 and 700. 700 only for h1, h2, h3, the wordmark and the footer disclaimer; the h1 is
  the largest and heaviest text. h1 `letter-spacing: -0.02em`, `line-height: 1.04`, `text-wrap: balance`.
- Body line height 1.5; notes 1.45; dek capped at 34ch, the pays-for paragraph at 60ch.

## Layout

- `.page`: max 1320px, 16px side padding. Spacing scale `--space-1..6` = 4, 8, 12, 16, 24, 32px.
- `.front` grid, mobile first: `minmax(0,1fr) 112px` with areas `lead cover / subscribe subscribe /
  deliver deliver`. From 640px the cover column is 200px. From 960px three columns
  `1.1fr 0.8fr 1fr`, areas `lead cover deliver / subscribe cover deliver`, separated by 1px ink rules
  on the cover column; the cover is capped at 62vh.
- `.panel`: top rule, 16px vertical padding, 12px gap. Long values wrap (`overflow-wrap: anywhere` on
  notes, steps and the footer address) so nothing scrolls sideways at 320px.
- Footer: disclaimer, address row (full checksummed address, Copy, Etherscan, Source), four-line
  "How it works", explorer links for IMD and The IMD Daily.

## Elevation and depth

Deliberately flat: no shadows. Structure comes from 1px rules and the 4px red masthead rule. The
connect sheet sits over a 45% ink backdrop.

## Components (`web/src`)

- `.btn` (44px min height, square corners, 150ms color transitions, disabled at 45% opacity) with
  variants `.btn-red` (main action), `.btn-ink` (Connect, Deliver, Yes cancel), `.btn-quiet` (soft
  border: Disconnect, Cancel and refund, Copy), `.btn-small` (32px), `.btn-main` (full width).
  States: rest, hover, active, `:focus-visible` 2px ink ring offset 2px.
- `WalletControl` / `ConnectSheet` (`wallet.tsx`): one control; Connect, short address with
  Disconnect, or "Switch to Ethereum". Sheet: bottom sheet under 640px, centered above, max 420px,
  48px rows with 28px marks, × close, Escape, backdrop click, focus trap and focus return.
- `TxStatus` (`App.tsx`): ordered steps with left markers (red pending, green confirmed), explorer
  links, and a result line (`role=status` or `role=alert`), inside `aria-live=polite`.
- `Cover`: linked real cover with caption (title, sale window); a text-only frame while loading.
- `Copies`: grid of delivered covers (min 88px) with edition dates.
- `details.pays`: native disclosure "What the 5 IMD pays for".

## Do and don't

- Do read every number from the contracts; format with `amount()` in `format.ts` (bigint only).
- Do keep red for one action per panel and for errors.
- Don't add shadows, rounded cards, gradients, all-caps labels, em dashes or placeholder art.
