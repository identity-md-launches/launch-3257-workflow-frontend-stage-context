import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { getAbiItem, type AbiEvent, type Address, type Hex, type PublicClient } from "viem";
import { dailyAbi, erc20Abi, LOG_FROM_BLOCK, LOG_WINDOW, POLL_MS, type Issue } from "./config";
import { useDeployment } from "./deployment";

type RawIssue = {
  content: { title: string; editorialDate: bigint; pdfURL: string; coverURL: string };
  publishedAt: bigint;
  closesAt: bigint;
};
const toIssue = (id: bigint, r: RawIssue): Issue => ({
  id, title: r.content.title, editorialDate: r.content.editorialDate, coverURL: r.content.coverURL,
  pdfURL: r.content.pdfURL, publishedAt: r.publishedAt, closesAt: r.closesAt,
});

export type Core = {
  verified: boolean;
  verifyNote?: string;
  imd: Address;
  daily: Address;
  editionPrice: bigint;
  tip: bigint;
  copyPrice: bigint;
  decimals: number;
  subscriberCount: bigint;
  latest: Issue | null;
  open: boolean;
  waiting: Address[];
};

function usePR() {
  const dep = useDeployment();
  const client = usePublicClient({ chainId: dep.chain.id }) as PublicClient;
  return { dep, client, pr: dep.paperRoute };
}

/** Contract-wide state, read without a wallet. */
export function useCore() {
  const { dep, client, pr } = usePR();
  return useQuery({
    queryKey: ["core", pr.address],
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<Core> => {
      const read = <T,>(functionName: string, args: unknown[] = []) =>
        client.readContract({ address: pr.address, abi: pr.abi, functionName, args }) as Promise<T>;
      const [chainId, code, imd, daily, editionPrice, tip, copyPrice, subscriberCount] = await Promise.all([
        client.getChainId(), client.getCode({ address: pr.address }),
        read<Address>("IMD"), read<Address>("DAILY"), read<bigint>("EDITION_PRICE"), read<bigint>("TIP"),
        read<bigint>("COPY_PRICE"), read<bigint>("subscriberCount"),
      ]);
      let verifyNote: string | undefined;
      if (chainId !== dep.chain.id) verifyNote = `The configured RPC answers for chain ${chainId}, not ${dep.chain.id}.`;
      else if (!code || code === "0x") verifyNote = "No contract code was found at the PaperRoute address.";
      const decimals = Number(await client.readContract({ address: imd, abi: erc20Abi, functionName: "decimals" }));
      const count = await client.readContract({ address: daily, abi: dailyAbi, functionName: "issueCount" });
      let latest: Issue | null = null;
      let open = false;
      let waiting: Address[] = [];
      if (count > 0n) {
        const [raw, avail] = await Promise.all([
          client.readContract({ address: daily, abi: dailyAbi, functionName: "getIssue", args: [count] }),
          client.readContract({ address: daily, abi: dailyAbi, functionName: "isAvailable", args: [count] }),
        ]);
        latest = toIssue(count, raw as RawIssue);
        open = avail;
        if (open && subscriberCount > 0n) {
          const PAGE = 200n;
          for (let off = 0n; off < subscriberCount; off += PAGE) {
            waiting = waiting.concat(await read<Address[]>("due", [count, off, PAGE]));
          }
        }
      }
      return { verified: !verifyNote, verifyNote, imd, daily, editionPrice, tip, copyPrice, decimals, subscriberCount, latest, open, waiting };
    },
  });
}

export type AccountState = { balance: bigint; allowance: bigint; editionsLeft: bigint; lastIssue: bigint; lastDeliveredAt: bigint };

/** The connected wallet's IMD and subscription. */
export function useAccountState(core: Core | undefined) {
  const { client, pr } = usePR();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["account", pr.address, address],
    enabled: !!address && !!core,
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<AccountState> => {
      const a = address!;
      const [balance, allowance, sub] = await Promise.all([
        client.readContract({ address: core!.imd, abi: erc20Abi, functionName: "balanceOf", args: [a] }),
        client.readContract({ address: core!.imd, abi: erc20Abi, functionName: "allowance", args: [a, pr.address] }),
        client.readContract({ address: pr.address, abi: pr.abi, functionName: "subscriptionOf", args: [a] }) as Promise<{
          editionsLeft: bigint; lastIssue: bigint; lastDeliveredAt: bigint;
        }>,
      ]);
      return { balance, allowance, editionsLeft: BigInt(sub.editionsLeft), lastIssue: BigInt(sub.lastIssue), lastDeliveredAt: BigInt(sub.lastDeliveredAt) };
    },
  });
}

async function scanLogs(client: PublicClient, address: Address, event: AbiEvent, args: Record<string, unknown>, from: bigint) {
  // cacheTime 0: a block number cached from before a just-confirmed transaction would hide its logs.
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  const logs: { blockNumber: bigint; transactionHash: Hex; args: Record<string, unknown> }[] = [];
  for (let start = from; start <= latest; start += LOG_WINDOW) {
    const last = start + LOG_WINDOW - 1n >= latest;
    // The final window runs to "latest" so nothing mined since the head was read is missed.
    const toBlock = last ? ("latest" as const) : start + LOG_WINDOW - 1n;
    const page = await client.getLogs({ address, event, args, fromBlock: start, toBlock } as Parameters<PublicClient["getLogs"]>[0]);
    for (const l of page) logs.push({ blockNumber: l.blockNumber!, transactionHash: l.transactionHash!, args: (l as unknown as { args: Record<string, unknown> }).args });
  }
  return { logs, latest };
}

export type Copy = Issue & { txHash?: Hex };

/** Copies Paper Route delivered to the connected wallet, newest first, from Delivered events. */
export function useHistory(core: Core | undefined, lastIssue: bigint | undefined) {
  const { client, pr } = usePR();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["history", pr.address, address, lastIssue?.toString()],
    enabled: !!address && !!core && !!lastIssue && lastIssue > 0n,
    queryFn: async (): Promise<{ copies: Copy[]; source: "events" | "balances" }> => {
      const event = getAbiItem({ abi: pr.abi, name: "Delivered" }) as AbiEvent;
      let found: { id: bigint; txHash?: Hex }[];
      let source: "events" | "balances" = "events";
      try {
        const { logs } = await scanLogs(client, pr.address, event, { subscriber: address }, LOG_FROM_BLOCK);
        found = logs.map((l) => ({ id: l.args.issueId as bigint, txHash: l.transactionHash }));
      } catch {
        // Some RPCs refuse wide eth_getLogs ranges. Fall back to the copies of issues up to the last one
        // Paper Route delivered that this wallet holds (one ERC-1155 balanceOfBatch call).
        source = "balances";
        const ids = Array.from({ length: Number(lastIssue!) }, (_, i) => BigInt(i + 1));
        const bals = await client.readContract({ address: core!.daily, abi: dailyAbi, functionName: "balanceOfBatch", args: [ids.map(() => address!), ids] });
        found = ids.filter((_, i) => bals[i]! > 0n).map((id) => ({ id }));
      }
      const copies = await Promise.all(
        found.map(async (f) => {
          const raw = await client.readContract({ address: core!.daily, abi: dailyAbi, functionName: "getIssue", args: [f.id] });
          return { ...toIssue(f.id, raw as RawIssue), txHash: f.txHash };
        }),
      );
      return { copies: copies.sort((a, b) => (a.id < b.id ? 1 : -1)), source };
    },
  });
}

/** The most recent delivery of the open issue: when, and in which transaction. */
export function useLastDelivery(core: Core | undefined) {
  const { client, pr } = usePR();
  const issueId = core?.open ? core.latest?.id : undefined;
  return useQuery({
    queryKey: ["lastDelivery", pr.address, issueId?.toString(), core?.subscriberCount.toString()],
    enabled: issueId !== undefined,
    queryFn: async () => {
      const event = getAbiItem({ abi: pr.abi, name: "Delivered" }) as AbiEvent;
      const head = await client.getBlockNumber({ cacheTime: 0 });
      // An issue is on sale for 24 hours, about 7,200 blocks; 9,000 leaves room.
      const from = head > LOG_FROM_BLOCK + 9000n ? head - 9000n : LOG_FROM_BLOCK;
      const { logs } = await scanLogs(client, pr.address, event, { issueId }, from);
      const last = logs[logs.length - 1];
      if (!last) return null;
      const block = await client.getBlock({ blockNumber: last.blockNumber });
      return { at: block.timestamp, txHash: last.transactionHash, count: logs.length };
    },
  });
}
