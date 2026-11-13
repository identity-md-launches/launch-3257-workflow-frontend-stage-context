// Interaction test of the built export (../../dist) in headless Chromium, with no chain and no real
// wallet: public-RPC requests are answered by fakechain.mjs and an EIP-6963 test wallet is injected.
// Usage: IMD_PLAYWRIGHT=/path/to/playwright-core/index.mjs [CHROMIUM=/path/to/chrome] node e2e/run.mjs [shotsDir]
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeFunctionData, getAddress } from "viem";
import { createChain, MULTICALL3, PRICE } from "./fakechain.mjs";
import { deliverGasOf } from "./gas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../../dist");
const shots = process.argv[2] ? resolve(process.argv[2]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const { chromium } = await import(process.env.IMD_PLAYWRIGHT ? pathToFileURL(process.env.IMD_PLAYWRIGHT).href : "playwright-core");

const manifest = JSON.parse(readFileSync(join(dist, "imd-deployment.json"), "utf8"));
const prEntry = manifest.contracts.find((c) => c.name === "PaperRoute");
const prAbi = JSON.parse(readFileSync(join(dist, prEntry.abiPath), "utf8"));
const src = readFileSync(resolve(here, "../src/config.ts"), "utf8");
// The page's own standard fragments, evaluated from source so the test and page cannot drift.
const grab = (name) => eval("(" + src.split(`export const ${name} = `)[1].split("] as const;")[0] + "])");
const IMD = getAddress("0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7");
const DAILY = getAddress("0xb8fd2b7fb37cbf03a26b4c4688ed5cce86c0a9c5");
const PR = getAddress(prEntry.address);
const chain = createChain({ prAbi, prAddress: PR, imd: IMD, daily: DAILY, erc20Abi: grab("erc20Abi"), dailyAbi: grab("dailyAbi"), multicall3Abi: grab("multicall3Abi") });
const s = chain.s;
const E = 10n ** 18n;
const USER = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
const S1 = getAddress("0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc");
const S2 = getAddress("0x15d34aaf54267db7d7c367839aaf71a00a2c6a65");
for (const a of [S1, S2]) { chain.sub(a).editionsLeft = 40n; s.list.push(a); }
s.ensNames[S1.toLowerCase()] = "early-reader.eth";
s.balances[USER.toLowerCase()] = 1n * E; // too little at first
const cover = readFileSync(resolve(here, "../public/og.png"));

let failures = 0, passes = 0;
const check = (cond, label) => { if (cond) { passes++; console.log(`  ok   ${label}`); } else { failures++; console.log(`  FAIL ${label}`); } };
const errors = [];

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
const ctx = await browser.newContext({ viewport: { width: 1383, height: 968 } });
const ORIGIN = "http://paper.test";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
await ctx.route("**/*", async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin === ORIGIN && url.pathname.startsWith("/preview/")) {
    const rel = url.pathname.slice("/preview/".length) || "index.html";
    const file = join(dist, rel);
    if (!file.startsWith(dist) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  }
  if (manifest.network.rpcUrls.some((u) => req.url().startsWith(u))) {
    const body = JSON.parse(req.postData() ?? "{}");
    const one = (m) => { try { return { jsonrpc: "2.0", id: m.id, result: chain.rpc(m.method, m.params) }; } catch (e) { if (process.env.E2E_DEBUG && !e.rpc) console.log("rpc error", m.method, e.message.slice(0, 300)); return { jsonrpc: "2.0", id: m.id, error: e.rpc ?? { code: -32000, message: e.message } }; } };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
  }
  if (url.hostname === "the-imd-daily.duckdns.org") return route.fulfill({ status: 200, contentType: "image/png", body: cover });
  return route.abort();
});
await ctx.exposeBinding("__wallet", async ({ page }, msg) => {
  const { method, params } = JSON.parse(msg);
  try {
    const result = chain.wallet(method, params, USER);
    if (method === "wallet_switchEthereumChain") setTimeout(() => page.evaluate((c) => window.__emit("chainChanged", c), s.walletChain).catch(() => {}), 20);
    return JSON.stringify({ result });
  } catch (e) {
    return JSON.stringify({ error: e.rpc ?? { code: -32000, message: e.message } });
  }
});
await ctx.addInitScript(() => {
  const listeners = {};
  window.__emit = (ev, data) => (listeners[ev] || []).forEach((f) => f(data));
  const provider = {
    isTestWallet: true,
    request: async ({ method, params }) => {
      const j = JSON.parse(await window.__wallet(JSON.stringify({ method, params })));
      if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
      return j.result;
    },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
  };
  const detail = Object.freeze({
    info: { uuid: "6c0e5d3a-1111-4222-8333-944455556666", name: "Test Wallet", rdns: "org.example.testwallet",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' fill='%23444'/%3E%3C/svg%3E" },
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
});

const page = await ctx.newPage();
process.on("uncaughtException", async (e) => {
  console.log("FAIL (exception)", e.message.split("\n")[0]);
  try { console.log("--- page text ---\n" + (await page.locator("main").innerText()).slice(0, 1500)); } catch {}
  console.log(`\n${passes} passed, ${failures + 1} failed`);
  process.exit(1);
});
page.on("pageerror", (e) => { errors.push(`pageerror: ${e.message}`); if (process.env.E2E_DEBUG) console.log("pageerror", e.message); });
page.on("requestfailed", (r) => { if (process.env.E2E_DEBUG) console.log("requestfailed", r.url(), r.failure()?.errorText); });
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); if (process.env.E2E_DEBUG) console.log("console", m.type(), m.text().slice(0, 300)); });
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, name), fullPage: false }); };
const btn = (name) => page.getByRole("button", { name, exact: false });
const text = (t) => page.getByText(t, { exact: false }).first();
const until = async (fn, label, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await page.waitForTimeout(150); }
  check(false, `${label} (timed out)`); return false;
};

console.log("1. Reads without a wallet (1383x968)");
await page.goto(`${ORIGIN}/preview/`);
await text("Issue #24").waitFor({ timeout: 15000 });
const img = page.locator("figure.cover img");
const SITE = "https://the-imd-daily-free-to-read-colle.sites.imd.fun/";
const X = "https://x.com/theimddaily";
check((await img.getAttribute("src")) === "https://the-imd-daily.duckdns.org/files/cover-23.png", "latest cover is the issue's coverURL read from The IMD Daily");
check((await page.locator("figure.cover a").first().getAttribute("href")) === SITE, "cover links to The IMD Daily's site");
const links = async (scope) => page.locator(scope).evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")]));
check(JSON.stringify(await links(".paper-links a")) === JSON.stringify([["Read the paper", SITE, "_blank"], ["@theimddaily", X, "_blank"]]), "under the cover: Read the paper and @theimddaily, new tab");
check((await page.locator(".paper-line").innerText()).startsWith("The paper itself:"), "footer line starts 'The paper itself:'");
check(JSON.stringify(await links(".paper-line a")) === JSON.stringify([["The IMD Daily", SITE, "_blank"], ["@theimddaily", X, "_blank"]]), "footer: The IMD Daily and @theimddaily, new tab");
check(await page.evaluate(() => document.querySelector(".disclaimer").nextElementSibling.classList.contains("paper-line")), "footer paper line follows the disclaimer");
await btn("Deliver today's edition and earn 0.05 IMD").waitFor({ timeout: 10000 });
check(await text("Unofficial. Not run by The IMD Daily.").isVisible(), "footer disclaimer");
check(await page.locator("footer code").innerText() === PR, "footer shows the checksummed PaperRoute address");
check(await text("Pay once. A copy of each day's edition is minted to your wallet, for as many editions as you choose.").isVisible(), "new dek");
check(await text("You prepay 0.125 IMD an edition, for as many editions as you like.").isVisible(), "new How it works line");
check((await page.locator("body").innerText()).indexOf("—") === -1, "no em dash in the copy");

console.log("1b. Editions picker");
await btn("Subscribe for 1.25 IMD").waitFor({ timeout: 10000 });
check(await page.locator('.pick[aria-pressed="true"]').innerText() === "10", "10 is picked on load");
check(await text("10 editions, one a day.").isVisible(), "line under the button follows the pick");
check(await text("What the 1.25 IMD pays for").isVisible(), "pays-for summary names 1.25 IMD");
const field = page.getByLabel("Any number of editions");
await page.locator(".pick", { hasText: /^500$/ }).click();
check(await btn("Subscribe for 62.5 IMD").isVisible(), "500 editions: Subscribe for 62.5 IMD");
check(await text("500 editions, one a day.").isVisible(), "500 editions, one a day.");
await text("What the 62.5 IMD pays for").click();
check(await text("50 IMD buys 500 copies").isVisible() && await text("12.5 IMD tips the deliveries").isVisible(), "pays-for numbers follow the pick");
await field.fill("7");
check(await btn("Subscribe for 0.875 IMD").isVisible() && await text("7 editions, one a day.").isVisible(), "typed 7: 0.875 IMD, updates at once");
check((await page.locator('.pick[aria-pressed="true"]').count()) === 0, "no quick pick pressed for 7");
await field.fill("1000000");
check(await btn("Subscribe for 125,000 IMD").isVisible(), "1,000,000 editions accepted");
for (const bad of ["", "0", "1.5", "abc", "1000001", "-3"]) {
  await field.fill(bad);
  const ok = await text("Enter a whole number of editions, from 1 to 1,000,000.").isVisible() && await btn("Subscribe").isDisabled();
  check(ok, `field "${bad}" disables the button with one line`);
}
await page.locator(".pick", { hasText: /^10$/ }).click();

console.log("1c. Subscribers list (no wallet)");
await text("Subscribers: 2").waitFor({ timeout: 10000 });
check(await text("80 editions prepaid in total.").isVisible(), "total editions prepaid from reservedEditions()");
check((await page.locator(".subs tbody tr").count()) === 2, "one row a subscriber");
await until(async () => (await page.locator(".subs a", { hasText: "early-reader.eth" }).count()) === 1, "ENS name shown once resolved");
check((await page.locator(".subs a", { hasText: "early-reader.eth" }).getAttribute("href")) === `https://etherscan.io/address/${S1}`, "row links to Etherscan");
check(await page.locator(".subs a", { hasText: `${S2.slice(0, 6)}…${S2.slice(-4)}` }).count() === 1, "address without a name in short form");
check((await page.locator(".subs td", { hasText: "none yet" }).count()) === 2, "no delivery yet: none yet");

const vh = 968;
for (const [label, loc] of [["headline", page.locator("h1")], ["cover", img], ["Subscribe button", btn("Subscribe for 1.25 IMD")], ["Deliver button", btn("Deliver today's edition")]]) {
  const b = await loc.boundingBox();
  check(b && b.y + b.height <= vh, `${label} fits the 1383x968 first screen (bottom ${b ? Math.round(b.y + b.height) : "?"})`);
}
await shot("desktop-disconnected.png");

console.log("2. Connect sheet, wrong network, add chain");
await btn("Subscribe for 1.25 IMD").click();
await page.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
check(await btn("Test Wallet").isVisible(), "EIP-6963 wallet listed by its own name");
check(await btn("Coinbase Wallet").isVisible(), "Coinbase Wallet row listed");
check((await page.getByText("Injected").count()) === 0, "the word Injected never shows");
await page.keyboard.press("Escape");
check((await page.getByRole("dialog").count()) === 0, "Escape closes the sheet");
await btn("Connect").click();
await btn("Test Wallet").click();
await btn("Switch to Ethereum").waitFor({ timeout: 10000 });
check(await btn("Subscribe for 1.25 IMD").isDisabled(), "Subscribe disabled on the wrong network");
await btn("Switch to Ethereum").click();
await until(async () => s.added.length === 1, "wallet_addEthereumChain requested after 4902");
check(JSON.stringify(s.added[0]) === JSON.stringify(manifest.walletAddChain), "wallet_addEthereumChain used walletAddChain unchanged");
await until(async () => (await btn("Disconnect").count()) > 0, "switched and connected");
check(s.walletChain === "0x1", "wallet now on chain 1");

console.log("3. Low balance follows the pick");
await text("This needs 1.25 IMD. Your wallet holds 1 IMD.").waitFor({ timeout: 10000 });
check(await btn("Subscribe for 1.25 IMD").isDisabled(), "Subscribe disabled when the pick costs more than the balance");
await page.locator(".pick", { hasText: /^5$/ }).click();
await until(async () => !(await btn("Subscribe for 0.625 IMD").isDisabled()), "5 editions (0.625 IMD) affordable with 1 IMD");
check((await text("This needs").count()) === 0 || !(await text("This needs").isVisible()), "balance line gone once affordable");
s.balances[USER.toLowerCase()] = 100n * E;
await page.reload();
await until(async () => (await btn("Disconnect").count()) > 0, "reconnects after reload");
await until(async () => !(await btn("Subscribe for 1.25 IMD").isDisabled()), "Subscribe enabled with 100 IMD");
check(await text("approve 1.25 IMD for Paper Route, then to subscribe").isVisible(), "explains the two confirmations before signing");

console.log("4. Rejected signature");
s.rejectNext = true;
await btn("Subscribe for 1.25 IMD").click();
await text("You declined the request in your wallet. Nothing was sent.").waitFor({ timeout: 10000 });
check(s.sent.length === 0, "nothing was sent");

console.log("5. Subscribe: approve 1.25 IMD then subscribe(10)");
await btn("Subscribe for 1.25 IMD").click();
await text("Subscribed. 10 editions").waitFor({ timeout: 15000 });
check(s.sent[0]?.functionName === "approve" && s.sent[0].to === IMD.toLowerCase() && s.sent[0].args[0] === PR && s.sent[0].args[1] === 1250n * E / 1000n, "approve(PaperRoute, 1.25 IMD) on IMD");
check(s.sent[1]?.functionName === "subscribe" && s.sent[1].args[0] === 10n, "subscribe(10)");
check((await page.locator(".tx a").first().getAttribute("href"))?.startsWith("https://etherscan.io/tx/0x"), "transaction link to Etherscan");
await until(async () => (await page.locator(".figure .num").count()) > 0 && (await page.locator(".figure .num").innerText()) === "10", "Your subscription shows 10 editions left");
await until(async () => (await text("Subscribers: 3").count()) > 0, "list refreshed after subscribing: Subscribers: 3");
check(await page.locator(".subs tr.mine .you").innerText() === "you", "own row marked you");
check(await btn("Add editions").isVisible() && await btn("Cancel and refund 1.25 IMD").isVisible(), "subscriber sees Add editions and Cancel and refund 1.25 IMD");
const order = await page.locator(".subs td.n").allInnerTexts();
check(JSON.stringify(order) === JSON.stringify(["40", "40", "10"]), `most editions left first (${order.join(",")})`);
await shot("desktop-subscribed.png");

const erc20 = grab("erc20Abi");
/** Decodes a sent aggregate3 into its two entries. */
const entries = (tx) => tx.args[0].map((c) => ({
  target: getAddress(c.target), allowFailure: c.allowFailure,
  ...decodeFunctionData({ abi: getAddress(c.target) === PR ? prAbi : erc20, data: c.callData }),
}));
const balOf = (a) => s.balances[a.toLowerCase()] ?? 0n;
const mcHeld = 10n * E / 1000n; // IMD someone left in Multicall3 earlier: swept to the deliverer too

console.log("6. Deliver through Multicall3 with the page's gas limit");
s.balances[MULTICALL3] = mcHeld;
await btn("Deliver today's edition and earn 0.075 IMD").waitFor({ timeout: 15000 });
check(await text("Tips on offer").isVisible(), "tips on offer shown");
check(await text("Your wallet shows a call to Multicall3").isVisible(), "explains the Multicall3 call before signing");
let balBefore = balOf(USER);
await btn("Deliver today's edition and earn 0.075 IMD").click();
await text("Delivered 3 copies. 0.075 IMD").waitFor({ timeout: 15000 });
const d = s.sent.at(-1);
const [e1, e2] = entries(d);
check(d.to === MULTICALL3 && d.functionName === "aggregate3" && d.args[0].length === 2, "one aggregate3 call to Multicall3 with two entries");
check(e1.target === PR && e1.allowFailure === false && e1.functionName === "deliver" && e1.args[0] === 23n && e1.args[1].length === 3, "entry 1: PaperRoute.deliver(23, [3 simulated-delivered subscribers]), allowFailure false");
check(e2.target === IMD && e2.allowFailure === false && e2.functionName === "transfer" && e2.args[0] === USER && e2.args[1] === 3n * PRICE.tip + mcHeld,
  `entry 2: IMD.transfer(wallet, 3 x 0.025 + 0.01 held = 0.085 IMD), allowFailure false (sent ${e2.args?.[1]})`);
check(d.gas === 1_250_000n && d.gas === deliverGasOf(3), `the page still asks for 650,000 + 3 x 200,000 = 1,250,000 gas (sent ${d.gas})`);
check(d.status === "0x1" && s.logs.filter((l) => l.tx === d.hash).length === 3, "3 Delivered events in the receipt");
check(balOf(USER) - balBefore === 3n * PRICE.tip + mcHeld && balOf(MULTICALL3) === 0n, "the tips (and the stray 0.01 IMD) reached the wallet; Multicall3 keeps nothing");
await text("Today's edition was delivered at").waitFor({ timeout: 15000 });
check((await page.locator(".deliver .note.ok a").first().getAttribute("href")) === `https://etherscan.io/tx/${d.hash}`, "delivered message links the delivery transaction");
await until(async () => (await page.locator(".copies img").count()) === 1, "delivered copy's cover shown");
check(await text("November 13, 2026").isVisible(), "delivered copy's date shown");
await until(async () => (await page.locator(".figure .num").innerText()) === "9", "9 editions left after delivery");
await until(async () => (await page.locator(".subs td", { hasText: "none yet" }).count()) === 0, "list refreshed after delivery: last delivered dates shown");

console.log("6b. A wallet that replaces the page's gas limit with too little: reverts, nothing delivered");
s.issueCount = 24n;
for (const a of s.list) chain.sub(a).lastDeliveredAt -= 72_000n;
s.walletGas = 200_000n;
await page.reload();
await btn("Deliver today's edition and earn 0.075 IMD").waitFor({ timeout: 15000 });
balBefore = balOf(USER);
let left = s.list.map((a) => chain.sub(a).editionsLeft);
let sentBefore = s.sent.length;
await btn("Deliver today's edition and earn 0.075 IMD").click();
await text("The delivery transaction reverted. Nothing was delivered and no subscriber was charged").waitFor({ timeout: 15000 });
const d2 = s.sent.at(-1);
check(s.sent.length === sentBefore + 1 && d2.functionName === "aggregate3" && d2.gas === 1_250_000n && d2.gasUsed === 200_000n && d2.status === "0x0", "the page asked for 1,250,000 gas; the wallet sent 200,000; the transaction reverted");
check(s.logs.filter((l) => l.tx === d2.hash).length === 0, "no Delivered event");
check(balOf(USER) === balBefore && s.list.map((a) => chain.sub(a).editionsLeft).join() === left.join(), "no tip paid and no subscriber charged");
check((await page.locator(".deliver .note.error").getAttribute("role")) === "alert", "shown as an error");
check(await text("Deliver to 3 subscribers: reverted").isVisible(), "the transaction step reads reverted, with its link");
check((await text("Delivered 3 copies").count()) === 0 || !(await text("Delivered 3 copies").isVisible()), "the simulation's result is never shown as what happened");
await until(async () => (await page.locator(".stats dd").first().innerText()) === "3", "waiting count re-read from chain: still 3");

console.log("6c. A wallet that ignores the page's gas limit and sends eth_estimateGas x 1.1 (Rainbow)");
s.walletGas = null;
s.walletEstimates = true;
// The bug this fixes: the same wallet on a plain deliver() estimates a limit that mints nobody.
const plainCall = { from: USER, to: PR, data: (await import("viem")).encodeFunctionData({ abi: prAbi, functionName: "deliver", args: [24n, s.list] }) };
const plainEst = BigInt(chain.rpc("eth_estimateGas", [plainCall]));
const plainSim = (await import("viem")).decodeFunctionResult({ abi: prAbi, functionName: "deliver", data: chain.rpc("eth_call", [{ ...plainCall, gas: "0x" + (plainEst * 11n / 10n).toString(16) }]) });
check(plainSim.length === 0, `stand-in reproduces the bug: a plain deliver() at estimate x 1.1 (${plainEst * 11n / 10n} gas) delivers nobody`);
await page.reload();
await btn("Deliver today's edition and earn 0.075 IMD").waitFor({ timeout: 15000 });
balBefore = balOf(USER);
await btn("Deliver today's edition and earn 0.075 IMD").click();
await text("Delivered 3 copies. 0.075 IMD").waitFor({ timeout: 15000 });
const d3 = s.sent.at(-1);
check(d3.functionName === "aggregate3" && d3.gas === 1_250_000n && d3.estimate != null && d3.gasUsed === d3.estimate * 11n / 10n && d3.gasUsed !== d3.gas,
  `the wallet dropped the page's 1,250,000 and sent its own estimate x 1.1 = ${d3.gasUsed}`);
check(d3.status === "0x1" && s.logs.filter((l) => l.tx === d3.hash).length === 3, "the copies were minted: 3 Delivered events");
check(balOf(USER) - balBefore === 3n * PRICE.tip, "0.075 IMD in tips reached the wallet");
check(s.list.every((a) => chain.sub(a).lastIssue === 24n), "every listed subscriber has issue 24");
await until(async () => (await page.locator(".copies img").count()) === 2, "second delivered copy shown in the history");
s.walletEstimates = false;

console.log("6d. Simulation delivers nobody: nothing is sent");
s.issueCount = 25n;
for (const a of s.list) chain.sub(a).lastDeliveredAt -= 72_000n;
s.mintFails = true; // due() lists them, but every mint would fail
await page.reload();
await btn("Deliver today's edition and earn 0.075 IMD").waitFor({ timeout: 15000 });
sentBefore = s.sent.length;
await btn("Deliver today's edition and earn 0.075 IMD").click();
await text("Nobody can be delivered right now.").waitFor({ timeout: 15000 });
check(s.sent.length === sentBefore, "no transaction sent");
s.mintFails = false;

console.log("6e. The aggregate3 simulation reverts: nothing is sent");
s.transferBlocked = true;
await btn("Deliver today's edition and earn 0.075 IMD").click();
await text("The delivery would fail right now, so nothing was sent.").waitFor({ timeout: 15000 });
check(s.sent.length === sentBefore, "no transaction sent");
check(s.list.every((a) => chain.sub(a).lastIssue === 24n), "nobody was charged");
s.transferBlocked = false;
for (const a of s.list) chain.sub(a).lastIssue = 25n;

console.log("7. Add editions");
s.balances[USER.toLowerCase()] = 1n * E;
await page.reload();
await until(async () => (await btn("Add editions").count()) > 0 && !(await btn("Add editions").isDisabled()), "subscription view after reload");
check((await text("This needs").count()) === 0, "no balance line under a subscription that is only being read");
await btn("Add editions").click();
await btn("Add 10 for 1.25 IMD").waitFor({ timeout: 5000 });
check(await text("This needs 1.25 IMD. Your wallet holds 1 IMD.").isVisible() && await btn("Add 10 for 1.25 IMD").isDisabled(), "balance line and disabled button while the picker is open");
await btn("Close").click();
check((await text("This needs").count()) === 0, "balance line gone when the picker closes");
s.balances[USER.toLowerCase()] = 100n * E;
await page.reload();
await until(async () => (await btn("Add editions").count()) > 0 && !(await btn("Add editions").isDisabled()), "subscription view after reload");
await btn("Add editions").click();
await page.locator(".pick", { hasText: /^50$/ }).click();
await btn("Add 50 for 6.25 IMD").click();
await text("Subscribed. 50 editions").waitFor({ timeout: 15000 });
check(s.sent.at(-2).functionName === "approve" && s.sent.at(-2).args[1] === 6250n * E / 1000n && s.sent.at(-1).functionName === "subscribe" && s.sent.at(-1).args[0] === 50n, "approve 6.25 IMD then subscribe(50)");
await until(async () => (await page.locator(".figure .num").innerText()) === "58", "58 editions left (2 delivered, 50 added)");

console.log("8. Cancel and refund");
await btn("Cancel and refund 7.25 IMD").click();
check(await text("Refund 7.25 IMD and end deliveries?").isVisible(), "asks before cancelling");
const before = s.balances[USER.toLowerCase()];
await btn("Yes, cancel").click();
await text("Cancelled. 7.25 IMD was refunded").waitFor({ timeout: 15000 });
check(s.sent.at(-1).functionName === "cancel", "cancel() sent");
check(s.balances[USER.toLowerCase()] - before === 58n * PRICE.edition, "refund equals 58 x 0.125 IMD");
await until(async () => (await btn("Subscribe for 6.25 IMD").count()) > 0, "Subscribe offered again after cancelling, keeping the last pick (50)");
await until(async () => (await text("Subscribers: 2").count()) > 0, "list refreshed after cancelling");
check((await page.locator(".copies img").count()) === 2, "delivery history still shown after cancelling");

console.log("9. A long list: first 50, then Show all");
for (let i = 1; i <= 60; i++) {
  const a = getAddress("0x" + (0xabc000 + i).toString(16).padStart(40, "0"));
  chain.sub(a).editionsLeft = BigInt(i * 1000); s.list.push(a);
}
await page.reload();
await text("Subscribers: 62").waitFor({ timeout: 15000 });
check((await page.locator(".subs tbody tr").count()) === 50, "50 rows shown first");
const top = await page.locator(".subs td.n").first().innerText();
check(top === "60,000", `largest first (${top})`);
await btn("Show all 62").click();
check((await page.locator(".subs tbody tr").count()) === 62, "Show all reveals every row");

console.log("10. Middle width: Subscribe beside the cover");
for (const w of [640, 800, 959]) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.waitForTimeout(200);
  const [lead, cov, sub, del, subs] = await Promise.all([".lead", "figure.cover", ".subscribe", ".deliver", ".subscribers"].map((q) => page.locator(q).boundingBox()));
  const ok = sub.y - (lead.y + lead.height) < 2 && sub.x + sub.width <= cov.x + 1 && sub.y < cov.y + cov.height
    && del.y >= Math.max(cov.y + cov.height, sub.y + sub.height) - 1 && del.width > w - 80 && subs.y >= del.y + del.height - 1 && subs.width > w - 80;
  check(ok, `${w}px: Subscribe directly under the headline beside the cover; Deliver and Subscribers below at full width`);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `no horizontal scroll at ${w}`);
  if (w === 800) { await page.evaluate(() => window.scrollTo(0, 0)); await shot("tablet-800.png"); }
}

console.log("11. Narrow widths");
const longBal = 123456789012n * E + 123456789n;
s.balances[USER.toLowerCase()] = longBal;
s.ensNames[s.list[2].toLowerCase()] = "a-very-long-ens-name-for-a-subscriber-of-the-daily.eth";
for (const [w, h] of [[390, 844], [320, 640]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.reload();
  await until(async () => (await btn("Disconnect").count()) > 0, `connected at ${w}`);
  await text("Issue #26").waitFor({ timeout: 10000 });
  await text("Subscribers: 62").waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `no horizontal scroll at ${w} (overflow ${over}px)`);
  if (w === 390) {
    for (const [label, loc] of [["Subscribe button", btn("Subscribe for 1.25 IMD")], ["wallet button", btn("Disconnect")], ["cover", img]]) {
      const b = await loc.boundingBox();
      check(b && b.y + b.height <= h, `${label} on the 390x844 first screen`);
    }
  }
  await shot(`mobile-${w}.png`);
}
await btn("Disconnect").click();
await btn("Connect").click();
const sheetBox = await page.getByRole("dialog").boundingBox();
check(sheetBox && sheetBox.x >= 0 && sheetBox.x + sheetBox.width <= 320, "connect sheet fits at 320");
await shot("mobile-320-sheet.png");
await page.keyboard.press("Escape");

console.log("12. Nobody subscribed");
s.list = [];
await page.reload();
await text("Nobody is subscribed yet.").waitFor({ timeout: 15000 });
check(await text("Subscribers: 0").isVisible(), "heading states 0");

const relevant = errors.filter((e) => !/ERR_FAILED|net::|Failed to load resource/.test(e));
check(relevant.length === 0, `no page errors (${relevant.length})`);
if (errors.length) console.log("  console:", errors.slice(0, 8));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
