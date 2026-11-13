import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, type Hex } from "viem";

export type Step = { label: string; hash?: Hex; state: "wallet" | "pending" | "done" };
export type TxState = { status: "idle" | "busy" | "done" | "error"; steps: Step[]; message?: string };

const REASONS: Record<string, string> = {
  ZeroEditions: "Choose at least one edition.",
  TooManyEditions: "That would exceed the largest subscription the contract can hold.",
  InexactPayment: "IMD arrived short of the price, so the contract refused it.",
  NoSubscription: "This wallet has no unused editions to refund.",
  IssueNotOpen: "This issue is no longer on sale, so it cannot be delivered.",
  UnknownIssue: "The IMD Daily has no such issue.",
  MintClosed: "This issue is no longer on sale.",
};

/** Turns a wallet or contract error into one plain sentence that says what happened and what to do. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const rejected = e.walk((x) => (x as { code?: number }).code === 4001 || /User rejected|User denied/i.test((x as Error).message ?? ""));
    if (rejected) return "You declined the request in your wallet. Nothing was sent.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name && REASONS[name]) return REASONS[name]!;
    if (revert?.reason) return `The contract refused: ${revert.reason}.`;
    if (/insufficient funds/i.test(e.message)) return "Your wallet does not have enough ETH to pay the network fee.";
    return e.shortMessage;
  }
  const x = e as { code?: number; message?: string };
  if (x?.code === 4001) return "You declined the request in your wallet. Nothing was sent.";
  return x?.message?.split("\n")[0] ?? "Something went wrong.";
}

/** Runs a sequence of wallet steps and exposes each one's state for the status list. */
export function useTx() {
  const [state, setState] = useState<TxState>({ status: "idle", steps: [] });
  const begin = (label: string) =>
    setState((s) => ({ status: "busy", steps: [...s.steps.filter((x) => x.state === "done"), { label, state: "wallet" }] }));
  const sent = (hash: Hex) =>
    setState((s) => ({ ...s, steps: s.steps.map((x, i) => (i === s.steps.length - 1 ? { ...x, hash, state: "pending" } : x)) }));
  const confirmed = (hashes?: Hex[]) =>
    setState((s) => ({
      ...s,
      steps: s.steps.map((x, i) => (i === s.steps.length - 1 ? { ...x, hash: hashes?.[hashes.length - 1] ?? x.hash, state: "done" } : x)),
    }));
  const run = async (fn: (h: { begin: typeof begin; sent: typeof sent; confirmed: typeof confirmed }) => Promise<string>) => {
    setState({ status: "busy", steps: [] });
    try {
      const message = await fn({ begin, sent, confirmed });
      setState((s) => ({ ...s, status: "done", message }));
    } catch (e) {
      setState((s) => ({ status: "error", steps: s.steps.filter((x) => x.state !== "wallet"), message: explain(e) }));
    }
  };
  return { state, run, reset: () => setState({ status: "idle", steps: [] }) };
}
