import { getCapabilities, sendCalls, simulateContract, waitForCallsStatus, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { encodeFunctionData, parseEventLogs, type Abi, type Address, type Hex } from "viem";
import { deliverGas } from "./config";
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

/**
 * deliver(issueId, addresses) with the page's own gas limit. Simulates from the connected address with
 * that same limit, sends only the addresses the simulation returns as delivered, and reports what the
 * receipt shows: the Delivered events PaperRoute emitted in that transaction, never the simulation.
 */
export async function sendDeliver(
  config: Config, h: Helpers, account: Address, chainId: number,
  pr: { address: Address; abi: Abi }, issueId: bigint, candidates: Address[],
): Promise<{ delivered: number; hash: Hex }> {
  const { result } = await simulateContract(config, {
    address: pr.address, abi: pr.abi, functionName: "deliver", args: [issueId, candidates],
    account, chainId, gas: deliverGas(candidates.length),
  } as Parameters<typeof simulateContract>[1]);
  const list = result as unknown as Address[];
  if (list.length === 0) throw new Error("Nobody can be delivered right now. Nothing was sent.");
  h.begin(`Deliver to ${list.length} subscriber${list.length === 1 ? "" : "s"}`);
  const hash = await writeContract(config, {
    address: pr.address, abi: pr.abi, functionName: "deliver", args: [issueId, list],
    account, chainId, gas: deliverGas(list.length),
  } as Parameters<typeof writeContract>[1]);
  h.sent(hash);
  const receipt = await waitForTransactionReceipt(config, { hash, chainId });
  if (receipt.status !== "success") throw new Error("The transaction reverted on chain. Nothing was delivered and no tip was paid.");
  h.confirmed([hash]);
  const own = receipt.logs.filter((l) => l.address.toLowerCase() === pr.address.toLowerCase());
  const delivered = parseEventLogs({ abi: pr.abi, logs: own, eventName: "Delivered" }).length;
  return { delivered, hash };
}
