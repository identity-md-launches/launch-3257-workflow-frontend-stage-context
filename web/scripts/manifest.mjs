// Runs after `vite build`. Copies each deployed contract's implementation-derived ABI into dist/abi/,
// checks its canonical Keccak hash against the deployment handoff, then writes dist/imd-deployment.json:
// the one runtime configuration the page loads (addresses, chain, ABI paths, network, asset hashes).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalKeccak } from "./canonical.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const root = resolve(web, "..");
const dist = join(root, "dist");
const handoffRaw = readFileSync(join(web, "deployment/handoff.json"), "utf8");
const networkRaw = readFileSync(join(web, "deployment/network.json"), "utf8");
const handoff = JSON.parse(handoffRaw);
const networkFile = JSON.parse(networkRaw);

const fail = (msg) => { console.error(`manifest: ${msg}`); process.exit(1); };
if (handoff.version !== 1) fail("unexpected handoff version");
if (networkFile.network.chainId !== handoff.chainId) fail("network.json chain differs from the handoff chain");

mkdirSync(join(dist, "abi"), { recursive: true });
const contracts = handoff.contracts.map((c) => {
  const src = join(root, "docs/abi", `${c.name}.json`);
  const bytes = readFileSync(src);
  const abi = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(abi)) fail(`${src} is not a raw ABI array`);
  const hash = canonicalKeccak(abi);
  if (hash !== c.abiHash) fail(`${c.name} ABI hash ${hash} != handoff ${c.abiHash}`);
  const abiPath = `abi/${c.name}.json`;
  writeFileSync(join(dist, abiPath), bytes);
  return { name: c.name, address: c.address, abiHash: c.abiHash, abiPath };
});

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p).split(sep).join("/"));
  }
};
walk(dist);
const assets = files
  .filter((p) => p !== "imd-deployment.json")
  .map((p) => {
    const buf = readFileSync(join(dist, p));
    if (buf.length > 8 * 1024 * 1024) fail(`${p} is over 8 MiB`);
    return { path: p, sha256: createHash("sha256").update(buf).digest("hex") };
  });
if (assets.length > 128) fail(`${assets.length} assets, limit 128`);
if (!assets.some((a) => a.path === "index.html")) fail("index.html missing from dist");

const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  network: networkFile.network,
  walletAddChain: networkFile.walletAddChain,
};
writeFileSync(join(dist, "imd-deployment.json"), JSON.stringify(manifest, null, 2) + "\n");
const total = assets.reduce((n, a) => n + statSync(join(dist, a.path)).size, 0);
console.log(`manifest: ${contracts.length} contract(s), ${assets.length} assets, ${total} bytes`);
