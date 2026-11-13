/**
 * The site's single configuration.
 *
 * Deployment facts (chain id, PaperRoute's address and ABI, public RPC URLs, explorer and the wallet's
 * add-chain parameters) are NOT written here: they are loaded at runtime from `./imd-deployment.json`,
 * the manifest generated from the deployment handoff, and the ABI file it names. The IMD token and
 * The IMD Daily collection are read from PaperRoute itself (`IMD()` and `DAILY()`), so no address map
 * can disagree with the deployed contract. What remains here is site copy, fixed brief values and
 * standard interface fragments. No private RPC, key or project ID exists anywhere in this site.
 */
import { defineChain, type Abi, type Address, type Chain } from "viem";
import { mainnet } from "viem/chains";

export const SITE_NAME = "Paper Route";
export const SITE_DESCRIPTION =
  "Pay once. A copy of each day's edition of The IMD Daily is minted to your wallet, for as many editions as you choose.";
/** The IMD Daily's own reading site; the cover, "Read the paper" and the footer link here. */
export const DAILY_SITE_URL = "https://the-imd-daily-free-to-read-colle.sites.imd.fun/";
/** The IMD Daily on X. */
export const DAILY_X_URL = "https://x.com/theimddaily";
export const DAILY_X_HANDLE = "@theimddaily";
/** Source repository of the deployed contracts and this page. */
export const SOURCE_REPO_URL = "https://github.com/identity-md-launches/launch-3256-paperroute";
/** Quick picks in the Editions row, and the one picked when the page loads. */
export const EDITION_PICKS = [5n, 10n, 50n, 500n] as const;
export const DEFAULT_EDITIONS = 10n;
/** Largest number of editions the field accepts in one subscribe(N). */
export const MAX_EDITIONS = 1_000_000n;
/** Most addresses passed to one deliver() call (the brief: at most 25 a transaction). */
export const MAX_DELIVER_BATCH = 25;
/**
 * Gas limit the page sets on every deliver() itself: base plus one allowance per listed address.
 * PaperRoute tries a mint only while about 556,000 gas is left and otherwise skips the address
 * without reverting, so a wallet's own estimate (taken from a run that already skips) delivers nobody.
 * Measured minimums on a mainnet fork: 596,976 gas for 1 address, 2,953,489 for 25.
 */
export const DELIVER_GAS_BASE = 650_000n;
export const DELIVER_GAS_PER_ADDRESS = 200_000n;
export const deliverGas = (addresses: number) => DELIVER_GAS_BASE + DELIVER_GAS_PER_ADDRESS * BigInt(addresses);
/** Subscribers shown before "Show all N". */
export const SUBSCRIBER_ROWS = 50;
/** Block PaperRoute was deployed in (handoff txHash 0xb0e721b1…1e48); event scans start here. */
export const LOG_FROM_BLOCK = 26406815n;
/** Widest eth_getLogs window sent to a public RPC. */
export const LOG_WINDOW = 40_000n;
/** How often live state is re-read, in milliseconds. */
export const POLL_MS = 20_000;
/** WalletConnect is wired only when a brief supplies an id; this one did not. */
export const WALLETCONNECT_PROJECT_ID = "";

export type Network = {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  pairToken?: { address: Address; symbol: string; name: string; decimals: number };
};
export type WalletAddChain = {
  chainId: `0x${string}`;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
};
export type DeploymentFile = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: Network;
  walletAddChain?: WalletAddChain;
};
export type Deployment = {
  file: DeploymentFile;
  chain: Chain;
  paperRoute: { address: Address; abi: Abi };
  walletAddChain: WalletAddChain;
};

const isPlainPath = (p: string) => !/^[a-z]+:|^\/|(^|\/)\.\.(\/|$)/i.test(p);

/** Loads ./imd-deployment.json and the ABI it names. Relative URLs keep this working on any gateway path. */
export async function loadDeployment(base = "./"): Promise<Deployment> {
  const res = await fetch(`${base}imd-deployment.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`imd-deployment.json could not be loaded (HTTP ${res.status}).`);
  const file = (await res.json()) as DeploymentFile;
  if (file.version !== 1 || file.network?.chainId !== file.chainId) throw new Error("imd-deployment.json is not a version 1 manifest for its own chain.");
  const entry = file.contracts.find((c) => c.name === "PaperRoute");
  if (!entry || !isPlainPath(entry.abiPath)) throw new Error("imd-deployment.json does not list PaperRoute with a relative ABI path.");
  const abiRes = await fetch(`${base}${entry.abiPath}`);
  if (!abiRes.ok) throw new Error(`${entry.abiPath} could not be loaded (HTTP ${abiRes.status}).`);
  const abi = (await abiRes.json()) as Abi;
  const n = file.network;
  const chain = defineChain({
    id: n.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: n.explorer } },
    testnet: n.testnet,
    // ENS reverse names (Subscribers list): viem's own Ethereum universal resolver, mainnet only.
    ...(n.chainId === mainnet.id ? { contracts: { ensUniversalResolver: mainnet.contracts.ensUniversalResolver } } : {}),
  });
  const walletAddChain: WalletAddChain = file.walletAddChain ?? {
    chainId: `0x${n.chainId.toString(16)}`,
    chainName: n.name,
    rpcUrls: n.rpcUrls,
    nativeCurrency: n.nativeCurrency,
    blockExplorerUrls: [n.explorer],
  };
  return { file, chain, paperRoute: { address: entry.address, abi }, walletAddChain };
}

/** Standard ERC-20 fragments used on IMD (address read from PaperRoute.IMD()). */
export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

/** The views PaperRoute's page reads from The IMD Daily (address read from PaperRoute.DAILY()). */
export const dailyAbi = [
  { type: "function", name: "issueCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOfBatch", stateMutability: "view", inputs: [{ name: "accounts", type: "address[]" }, { name: "ids", type: "uint256[]" }], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "isAvailable", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "bool" }] },
  {
    type: "function", name: "getIssue", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }],
    outputs: [{
      type: "tuple", components: [
        { name: "content", type: "tuple", components: [
          { name: "title", type: "string" }, { name: "editorialDate", type: "uint256" }, { name: "pdfURL", type: "string" },
          { name: "coverURL", type: "string" }, { name: "metadataURI", type: "string" }, { name: "pdfHash", type: "bytes32" },
          { name: "coverHash", type: "bytes32" }, { name: "metadataHash", type: "bytes32" },
        ] },
        { name: "publishedAt", type: "uint256" }, { name: "closesAt", type: "uint256" },
      ],
    }],
  },
] as const;

export type Issue = {
  id: bigint;
  title: string;
  editorialDate: bigint;
  coverURL: string;
  pdfURL: string;
  publishedAt: bigint;
  closesAt: bigint;
};
