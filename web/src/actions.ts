import { getCapabilities, sendCalls, simulateContract, waitForCallsStatus, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
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
