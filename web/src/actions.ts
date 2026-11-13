import { getCapabilities, getPublicClient, readContract, sendCalls, simulateContract, waitForCallsStatus, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { encodeFunctionData, parseEventLogs, type Abi, type Address, type Hex } from "viem";
import { deliverGas, erc20Abi, multicall3Abi } from "./config";
import { explain } from "./tx";
import type { Config } from "wagmi";
import type { useTx } from "./tx";

type Helpers = Parameters<Parameters<ReturnType<typeof useTx>["run"]>[0]>[0];
export type Call = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };

/** Whether the connected wallet can send several calls as one atomic confirmation (EIP-5792). */
export async function canBatch(config: Config, account: Address, chainId: number): Promise<boolean> {
  try {
    const caps = (await getCapabilities(config, { account, chainId })) as Record<string, unknown>;
    const c = (caps && typeof caps === "object" && ("atomic" in caps || "atomicBatch" in caps) ? caps : (caps as Record<number, unknown>)[chainId]) as
      | { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }
      | undefined;
    return c?.atomic?.status === "supported" || c?.atomic?.status === "ready" || c?.atomicBatch?.supported === true;
  } catch {
    return false;
  }
}

/** Simulate, ask the wallet to sign, wait for the receipt. Throws on a revert. */
export async function sendOne(config: Config, h: Helpers, label: string, account: Address, chainId: number, call: Call) {
  h.begin(label);
  const { request, result } = await simulateContract(config, { ...call, account, chainId } as Parameters<typeof simulateContract>[1]);
  const hash = await writeContract(config, request as Parameters<typeof writeContract>[1]);
  h.sent(hash);
  const receipt = await waitForTransactionReceipt(config, { hash, chainId });
  if (receipt.status !== "success") throw new Error("The transaction reverted on chain. Nothing changed.");
  h.confirmed([hash]);
  return result as unknown;
}

/** Several calls in one wallet confirmation (wallet_sendCalls), atomically. */
export async function sendBatch(config: Config, h: Helpers, label: string, account: Address, chainId: number, calls: Call[]) {
  h.begin(label);
  const { id } = await sendCalls(config, {
    account, chainId, forceAtomic: true,
    calls: calls.map((c) => ({ to: c.address, data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args }) })),
  });
  const status = await waitForCallsStatus(config, { id, timeout: 600_000 });
  const hashes = (status.receipts ?? []).map((r) => r.transactionHash as Hex);
  if (status.status !== "success") throw new Error("The batched calls did not go through. Nothing changed.");
  h.confirmed(hashes);
}

/** Thrown when the page decides not to send; the message is shown as it is. */
export class NotSent extends Error {
  name = "NotSent";
}

/**
 * Today's delivery, sent through Multicall3 as one aggregate3 call with two entries, both allowFailure
 * false: PaperRoute.deliver(issueId, list), then IMD.transfer(wallet, tips + whatever IMD Multicall3
 * already holds). PaperRoute pays the tips to its caller, Multicall3, and the transfer passes them on.
 * The transfer can only succeed when every listed copy was really minted, so a transaction with too
 * little gas reverts instead of delivering nobody, and a wallet's own eth_estimateGas comes out high
 * enough. Steps:
 * 1. simulate deliver(issueId, candidates) from Multicall3's address; keep only the addresses it returns;
 * 2. read IMD.balanceOf(Multicall3), build aggregate3, simulate it from the connected wallet;
 * 3. send it with the page's gas limit (a wallet may replace it with its own estimate);
 * 4. count the Delivered events PaperRoute emitted in the receipt. A revert means nothing happened.
 */
export async function sendDeliver(
  config: Config, h: Helpers, account: Address, chainId: number,
  d: { pr: { address: Address; abi: Abi }; multicall3: Address; imd: Address; tip: bigint },
  issueId: bigint, candidates: Address[],
): Promise<{ delivered: number; hash: Hex }> {
  const { pr, multicall3, imd, tip } = d;
  const { result } = await simulateContract(config, {
    address: pr.address, abi: pr.abi, functionName: "deliver", args: [issueId, candidates],
    account: multicall3, chainId, gas: deliverGas(candidates.length),
  } as Parameters<typeof simulateContract>[1]);
  const list = result as unknown as Address[];
  if (list.length === 0) throw new NotSent("Nobody can be delivered right now. Nothing was sent.");

  const held = await readContract(config, { address: imd, abi: erc20Abi, functionName: "balanceOf", args: [multicall3], chainId });
  const amount = BigInt(list.length) * tip + held;
  const calls = [
    { target: pr.address, allowFailure: false, callData: encodeFunctionData({ abi: pr.abi, functionName: "deliver", args: [issueId, list] }) },
    { target: imd, allowFailure: false, callData: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, amount] }) },
  ] as const;
  const gas = deliverGas(list.length);
  try {
    await simulateContract(config, { address: multicall3, abi: multicall3Abi, functionName: "aggregate3", args: [calls], account, chainId, gas });
  } catch (e) {
    // A known contract reason (an issue that just closed) is worth saying; anything else is one plain line.
    const why = explain(e);
    const known = /no longer on sale|no such issue/.test(why) ? ` ${why}` : " Nobody was charged. Try again in a moment.";
    throw new NotSent(`The delivery would fail right now, so nothing was sent.${known}`);
  }

  h.begin(`Deliver to ${list.length} subscriber${list.length === 1 ? "" : "s"}`);
  const hash = await writeContract(config, {
    address: multicall3, abi: multicall3Abi, functionName: "aggregate3", args: [calls], account, chainId, gas,
  });
  h.sent(hash);
  // viem's own receipt wait (wagmi's replays a reverted call and throws its reason instead of the status).
  const receipt = await getPublicClient(config, { chainId })!.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    h.reverted();
    throw new NotSent("The delivery transaction reverted. Nothing was delivered and no subscriber was charged; only the network fee was spent.");
  }
  h.confirmed([hash]);
  const own = receipt.logs.filter((l) => l.address.toLowerCase() === pr.address.toLowerCase());
  const delivered = parseEventLogs({ abi: pr.abi, logs: own, eventName: "Delivered" }).length;
  return { delivered, hash };
}
