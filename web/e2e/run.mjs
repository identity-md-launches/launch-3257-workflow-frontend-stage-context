// Interaction test of the built export (../../dist) in headless Chromium, with no chain and no real
// wallet: public-RPC requests are answered by fakechain.mjs and an EIP-6963 test wallet is injected.
// Usage: IMD_PLAYWRIGHT=/path/to/playwright-core/index.mjs [CHROMIUM=/path/to/chrome] node e2e/run.mjs [shotsDir]
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAddress } from "viem";
import { createChain, PRICE } from "./fakechain.mjs";

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
const chain = createChain({ prAbi, prAddress: PR, imd: IMD, daily: DAILY, erc20Abi: grab("erc20Abi"), dailyAbi: grab("dailyAbi") });
const s = chain.s;
const E = 10n ** 18n;
const USER = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
const S1 = getAddress("0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc");
const S2 = getAddress("0x15d34aaf54267db7d7c367839aaf71a00a2c6a65");
for (const a of [S1, S2]) { chain.sub(a).editionsLeft = 40n; s.list.push(a); }
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
check((await img.getAttribute("src")) === "https://the-imd-daily.duckdns.org/files/cover-23.png", "latest cover is the issue's coverURL read from The IMD Daily");
check((await page.locator("figure.cover a").first().getAttribute("href")) === "https://the-imd-daily-free-to-read-colle.sites.imd.fun", "cover links to The IMD Daily's site");
await btn("Deliver today's edition and earn 0.05 IMD").waitFor({ timeout: 10000 });
check(await text("Unofficial. Not run by The IMD Daily.").isVisible(), "footer disclaimer");
check(await page.locator("footer code").innerText() === PR, "footer shows the checksummed PaperRoute address");
const vh = 968;
for (const [label, loc] of [["headline", page.locator("h1")], ["cover", img], ["Subscribe button", btn("Subscribe for 5 IMD")], ["Deliver button", btn("Deliver today's edition")]]) {
  const b = await loc.boundingBox();
  check(b && b.y + b.height <= vh, `${label} fits the 1383x968 first screen (bottom ${b ? Math.round(b.y + b.height) : "?"})`);
}
await shot("desktop-disconnected.png");

console.log("2. Connect sheet, wrong network, add chain");
await btn("Subscribe for 5 IMD").click();
await page.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
check(await btn("Test Wallet").isVisible(), "EIP-6963 wallet listed by its own name");
check(await btn("Coinbase Wallet").isVisible(), "Coinbase Wallet row listed");
check((await page.getByText("Injected").count()) === 0, "the word Injected never shows");
await page.keyboard.press("Escape");
check((await page.getByRole("dialog").count()) === 0, "Escape closes the sheet");
await btn("Connect").click();
await btn("Test Wallet").click();
await btn("Switch to Ethereum").waitFor({ timeout: 10000 });
check(await btn("Subscribe for 5 IMD").isDisabled(), "Subscribe disabled on the wrong network");
await btn("Switch to Ethereum").click();
await until(async () => s.added.length === 1, "wallet_addEthereumChain requested after 4902");
check(JSON.stringify(s.added[0]) === JSON.stringify(manifest.walletAddChain), "wallet_addEthereumChain used walletAddChain unchanged");
await until(async () => (await btn("Disconnect").count()) > 0, "switched and connected");
check(s.walletChain === "0x1", "wallet now on chain 1");

console.log("3. Low balance, then reload with funds");
await text("This needs 5 IMD. Your wallet holds 1 IMD.").waitFor({ timeout: 10000 });
check(await btn("Subscribe for 5 IMD").isDisabled(), "Subscribe disabled with a short balance");
s.balances[USER.toLowerCase()] = 100n * E;
await page.reload();
await until(async () => (await btn("Disconnect").count()) > 0, "reconnects after reload");
await until(async () => !(await btn("Subscribe for 5 IMD").isDisabled()), "Subscribe enabled with 100 IMD");
check(await text("approve 5 IMD for Paper Route, then to subscribe").isVisible(), "explains the two confirmations before signing");

console.log("4. Rejected signature");
s.rejectNext = true;
await btn("Subscribe for 5 IMD").click();
await text("You declined the request in your wallet. Nothing was sent.").waitFor({ timeout: 10000 });
check(s.sent.length === 0, "nothing was sent");

console.log("5. Subscribe: approve 5 IMD then subscribe(40)");
await btn("Subscribe for 5 IMD").click();
await text("Subscribed. 40 editions").waitFor({ timeout: 15000 });
check(s.sent[0]?.functionName === "approve" && s.sent[0].to === IMD.toLowerCase() && s.sent[0].args[0] === PR && s.sent[0].args[1] === 5n * E, "approve(PaperRoute, 5 IMD) on IMD");
check(s.sent[1]?.functionName === "subscribe" && s.sent[1].args[0] === 40n, "subscribe(40)");
check((await page.locator(".tx a").first().getAttribute("href"))?.startsWith("https://etherscan.io/tx/0x"), "transaction link to Etherscan");
await until(async () => (await page.locator(".figure .num").count()) > 0 && (await page.locator(".figure .num").innerText()) === "40", "Your subscription shows 40 editions left");
await shot("desktop-subscribed.png");

console.log("6. Deliver today's edition");
await btn("Deliver today's edition and earn 0.075 IMD").waitFor({ timeout: 15000 });
check(await text("Tips on offer").isVisible(), "tips on offer shown");
const balBefore = s.balances[USER.toLowerCase()];
await btn("Deliver today's edition and earn 0.075 IMD").click();
await text("Delivered 3 copies. 0.075 IMD").waitFor({ timeout: 15000 });
const d = s.sent.at(-1);
check(d.functionName === "deliver" && d.args[0] === 23n && d.args[1].length === 3, "deliver(23, [3 due subscribers])");
check(s.balances[USER.toLowerCase()] - balBefore === 3n * PRICE.tip, "caller paid 3 x 0.025 IMD");
await text("Today's edition was delivered at").waitFor({ timeout: 15000 });
check((await page.locator(".deliver .note.ok a").first().getAttribute("href")) === `https://etherscan.io/tx/${d.hash}`, "delivered message links the delivery transaction");
await until(async () => (await page.locator(".copies img").count()) === 1, "delivered copy's cover shown");
check(await text("November 13, 2026").isVisible(), "delivered copy's date shown");
await until(async () => (await page.locator(".figure .num").innerText()) === "39", "39 editions left after delivery");

console.log("7. Add 40 more for 5 IMD");
await btn("Add 40 more for 5 IMD").click();
await text("Subscribed. 40 editions").waitFor({ timeout: 15000 });
check(s.sent.at(-2).functionName === "approve" && s.sent.at(-1).functionName === "subscribe" && s.sent.at(-1).args[0] === 40n, "approve then subscribe(40) again");
await until(async () => (await page.locator(".figure .num").innerText()) === "79", "79 editions left");

console.log("8. Cancel and refund");
await btn("Cancel and refund 9.875 IMD").click();
check(await text("Refund 9.875 IMD and end deliveries?").isVisible(), "asks before cancelling");
const before = s.balances[USER.toLowerCase()];
await btn("Yes, cancel").click();
await text("Cancelled. 9.875 IMD was refunded").waitFor({ timeout: 15000 });
check(s.sent.at(-1).functionName === "cancel", "cancel() sent");
check(s.balances[USER.toLowerCase()] - before === 79n * PRICE.edition, "refund equals 79 x 0.125 IMD");
await until(async () => (await btn("Subscribe for 5 IMD").count()) > 0, "Subscribe offered again after cancelling");
check((await page.locator(".copies img").count()) === 1, "delivery history still shown after cancelling");

console.log("9. Narrow widths");
const longBal = 123456789012n * E + 123456789n;
s.balances[USER.toLowerCase()] = longBal;
for (const [w, h] of [[390, 844], [320, 640]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.reload();
  await until(async () => (await btn("Disconnect").count()) > 0, `connected at ${w}`);
  await text("Issue #24").waitFor({ timeout: 10000 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 0, `no horizontal scroll at ${w} (overflow ${over}px)`);
  if (w === 390) {
    for (const [label, loc] of [["Subscribe button", btn("Subscribe for 5 IMD")], ["wallet button", btn("Disconnect")], ["cover", img]]) {
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

const relevant = errors.filter((e) => !/ERR_FAILED|net::|Failed to load resource/.test(e));
check(relevant.length === 0, `no page errors (${relevant.length})`);
if (errors.length) console.log("  console:", errors.slice(0, 8));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
