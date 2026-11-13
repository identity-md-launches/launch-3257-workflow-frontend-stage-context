// A small in-memory Ethereum stand-in for interaction tests: PaperRoute, IMD and The IMD Daily as the
// page uses them. Public-RPC reads and the injected test wallet both land here. Nothing touches a chain.
import {
  decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, encodeFunctionResult,
  getAddress, keccak256, toHex, parseUnits,
} from "viem";

const E = 10n ** 18n;
export const PRICE = { edition: 125n * E / 1000n, copy: E / 10n, tip: 25n * E / 1000n };

/** PaperRoute's gas behaviour on mainnet: a mint is tried only while about 556,000 gas is left, and one
 *  delivery uses about 182,000; below the floor the address is skipped without reverting. */
export const GAS = { floor: 556_000n, perDelivery: 182_000n, overhead: 60_000n, callDefault: 30_000_000n };
/** viem's ENS universal resolver on Ethereum, answered with names from s.ensNames. */
const ENS_RESOLVER = "0xeeeeeeee14d718c2b47d9923deab1335e144eeee";
const ensAbi = [{ type: "function", name: "reverseWithGateways", stateMutability: "view",
  inputs: [{ type: "bytes", name: "reverseName" }, { type: "uint256", name: "coinType" }, { type: "string[]", name: "gateways" }],
  outputs: [{ type: "string", name: "resolvedName" }, { type: "address", name: "resolver" }, { type: "address", name: "reverseResolver" }] }];

export function createChain({ prAbi, prAddress, imd, daily, erc20Abi, dailyAbi }) {
  const abi = [...prAbi, ...erc20Abi, ...dailyAbi];
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  const s = {
    block: 26_410_000n,
    balances: {},          // IMD balances by lowercase address
    allowances: {},        // owner -> spender -> amount
    subs: {},              // address -> { editionsLeft, lastIssue, lastDeliveredAt }
    list: [],              // subscribers with credit
    issueCount: 23n,
    open: true,
    logs: [],
    receipts: {},
    sent: [],              // decoded wallet transactions, for assertions
    walletChain: "0x5",
    walletGas: null,
    mintFails: false,      // every mint reverts inside deliver (due() still lists the subscribers)       // when set, the test wallet replaces the page's gas limit with this (as some wallets do)
    ensNames: {},          // lowercase address -> ENS name
    knownChains: new Set(["0x5"]),
    added: [],
    rejectNext: false,
    authorized: false,
    nonce: 0,
  };
  const lc = (a) => a.toLowerCase();
  const sub = (a) => (s.subs[lc(a)] ??= { editionsLeft: 0n, lastIssue: 0n, lastDeliveredAt: 0n });
  const bal = (a) => s.balances[lc(a)] ?? 0n;
  const allow = (o, sp) => s.allowances[lc(o)]?.[lc(sp)] ?? 0n;
  const issue = (id) => ({
    content: {
      title: `The IMD Daily | Issue #${Number(id) + 1} | November ${Number(id) - 10}, 2026`,
      editorialDate: 1794528000n - (23n - id) * 86400n,
      pdfURL: `https://the-imd-daily.duckdns.org/files/${id}.pdf`,
      coverURL: `https://the-imd-daily.duckdns.org/files/cover-${id}.png`,
      metadataURI: `https://the-imd-daily.duckdns.org/files/${id}.json`,
      pdfHash: keccak256(toHex(`pdf${id}`)), coverHash: keccak256(toHex(`c${id}`)), metadataHash: keccak256(toHex(`m${id}`)),
    },
    publishedAt: now() - 3600n, closesAt: now() + 20n * 3600n,
  });
  const isDue = (a, id) => {
    const x = sub(a);
    return x.editionsLeft > 0n && id > x.lastIssue && now() >= x.lastDeliveredAt + 72000n;
  };
  const revert = (name, args = []) => {
    const err = new Error("execution reverted");
    err.rpc = { code: 3, message: `execution reverted: ${name}`, data: encodeErrorResult({ abi: prAbi, errorName: name, args }) };
    throw err;
  };

  /** Executes (or, with apply=false, simulates) a call; returns the function's outputs. */
  function exec(from, to, data, apply, gas) {
    if (lc(to) === ENS_RESOLVER) {
      const { args } = decodeFunctionData({ abi: ensAbi, data });
      const name = s.ensNames[lc(args[0])];
      if (!name) { const e = new Error("reverted"); e.rpc = { code: 3, message: "execution reverted" }; throw e; }
      return encodeFunctionResult({ abi: ensAbi, functionName: "reverseWithGateways", result: [name, imd, imd] });
    }
    const { functionName: fn, args = [] } = decodeFunctionData({ abi, data });
    const out = (v) => encodeFunctionResult({ abi, functionName: fn, result: v });
    const t = lc(to);
    if (t === lc(prAddress)) {
      switch (fn) {
        case "IMD": return out(imd);
        case "DAILY": return out(daily);
        case "EDITION_PRICE": return out(PRICE.edition);
        case "TIP": return out(PRICE.tip);
        case "COPY_PRICE": return out(PRICE.copy);
        case "subscriberCount": return out(BigInt(s.list.length));
        case "subscriptionOf": { const x = sub(args[0]); return out({ editionsLeft: x.editionsLeft, lastIssue: x.lastIssue, lastDeliveredAt: x.lastDeliveredAt }); }
        case "editionsLeft": return out(sub(args[0]).editionsLeft);
        case "lastDeliveredAt": return out(sub(args[0]).lastDeliveredAt);
        case "reservedEditions": return out(s.list.reduce((n, a) => n + sub(a).editionsLeft, 0n));
        case "subscribers": { const [off, lim] = args; return out(s.list.slice(Number(off), Number(off + lim)).map((a) => getAddress(a))); }
        case "due": {
          const [id, off, lim] = args;
          if (!s.open || id !== s.issueCount) return out([]);
          return out(s.list.slice(Number(off), Number(off + lim)).filter((a) => isDue(a, id)).map((a) => getAddress(a)));
        }
        case "subscribe": {
          const [n] = args;
          if (n === 0n) revert("ZeroEditions");
          const cost = n * PRICE.edition;
          if (allow(from, prAddress) < cost) { const e = new Error("reverted"); e.rpc = { code: 3, message: "execution reverted: ERC20InsufficientAllowance" }; throw e; }
          if (bal(from) < cost) { const e = new Error("reverted"); e.rpc = { code: 3, message: "execution reverted: ERC20InsufficientBalance" }; throw e; }
          if (apply) {
            s.allowances[lc(from)][lc(prAddress)] -= cost;
            s.balances[lc(from)] = bal(from) - cost;
            const x = sub(from);
            if (x.editionsLeft === 0n) s.list.push(getAddress(from));
            x.editionsLeft += n;
          }
          return "0x";
        }
        case "cancel": {
          const x = sub(from);
          if (x.editionsLeft === 0n) revert("NoSubscription");
          if (apply) {
            s.balances[lc(from)] = bal(from) + x.editionsLeft * PRICE.edition;
            x.editionsLeft = 0n;
            s.list = s.list.filter((a) => lc(a) !== lc(from));
          }
          return "0x";
        }
        case "deliver": {
          const [id, readers] = args;
          if (!s.open || id !== s.issueCount) revert("IssueNotOpen", [id]);
          // Gas: like PaperRoute, skip (never revert) once too little gas is left for another mint.
          let left = BigInt(gas ?? GAS.callDefault) - GAS.overhead;
          const done = [];
          for (const a of readers) {
            if (!isDue(a, id)) continue;
            if (left < GAS.floor) break;
            if (s.mintFails) continue; // The IMD Daily reverts the mint: skipped (MintFailed), still listed by due()
            left -= GAS.perDelivery;
            done.push(a);
          }
          if (apply) {
            for (const a of done) {
              const x = sub(a);
              x.editionsLeft -= 1n; x.lastIssue = id; x.lastDeliveredAt = now();
              if (x.editionsLeft === 0n) s.list = s.list.filter((b) => lc(b) !== lc(a));
              s.logs.push({ eventName: "Delivered", args: { issueId: id, subscriber: getAddress(a), deliverer: getAddress(from) } });
            }
            s.balances[lc(from)] = bal(from) + BigInt(done.length) * PRICE.tip;
          }
          return out(done.map((a) => getAddress(a)));
        }
      }
    }
    if (t === lc(imd)) {
      switch (fn) {
        case "balanceOf": return out(bal(args[0]));
        case "allowance": return out(allow(args[0], args[1]));
        case "decimals": return out(18);
        case "symbol": return out("IMD");
        case "approve": if (apply) { (s.allowances[lc(from)] ??= {})[lc(args[0])] = args[1]; } return out(true);
      }
    }
    if (t === lc(daily)) {
      switch (fn) {
        case "issueCount": return out(s.issueCount);
        case "isAvailable": return out(s.open && args[0] === s.issueCount);
        case "getIssue": return out(issue(args[0]));
      }
    }
    throw new Error(`fakechain: no handler for ${fn} on ${to}`);
  }

  const blockObj = (n) => ({
    number: toHex(n), hash: keccak256(toHex(n)), parentHash: keccak256(toHex(n - 1n)), timestamp: toHex(now()),
    baseFeePerGas: "0x3b9aca00", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: imd, nonce: "0x0000000000000000",
    difficulty: "0x0", extraData: "0x", logsBloom: "0x" + "0".repeat(512), receiptsRoot: keccak256("0x01"),
    sha3Uncles: keccak256("0x02"), size: "0x1", stateRoot: keccak256("0x03"), transactionsRoot: keccak256("0x04"),
    transactions: [], uncles: [], mixHash: keccak256("0x05"), totalDifficulty: "0x0",
  });

  function logsFor(filter) {
    const deliveredTopic = encodeEventTopics({ abi: prAbi, eventName: "Delivered" })[0];
    return s.logs.map((l, i) => {
      const topics = encodeEventTopics({ abi: prAbi, eventName: l.eventName, args: l.args });
      return {
        address: lc(prAddress), topics, data: "0x", blockNumber: toHex(l.block), transactionHash: l.tx,
        transactionIndex: "0x0", blockHash: keccak256(toHex(l.block)), logIndex: toHex(i), removed: false,
      };
    }).filter((log) => {
      if (filter.address && lc(filter.address) !== log.address) return false;
      const b = BigInt(log.blockNumber);
      if (filter.fromBlock && BigInt(filter.fromBlock) > b) return false;
      if (filter.toBlock && filter.toBlock !== "latest" && BigInt(filter.toBlock) < b) return false;
      return (filter.topics ?? []).every((t, i) => t == null || (Array.isArray(t) ? t.includes(log.topics[i]) : t === log.topics[i])) && log.topics[0] === deliveredTopic;
    });
  }

  /** JSON-RPC as a public node would answer. */
  function rpc(method, params = []) {
    switch (method) {
      case "eth_chainId": return "0x1";
      case "net_version": return "1";
      case "eth_blockNumber": return toHex(s.block);
      case "eth_getCode": return "0x6080604052";
      case "eth_gasPrice": return "0x3b9aca00";
      case "eth_maxPriorityFeePerGas": return "0x3b9aca00";
      case "eth_estimateGas": return "0x30d40";
      case "eth_getTransactionCount": return toHex(s.nonce);
      case "eth_getBlockByNumber": return blockObj(params[0] === "latest" ? s.block : BigInt(params[0]));
      case "eth_getBlockByHash": return blockObj(s.block);
      case "eth_call": return exec(params[0].from ?? "0x0000000000000000000000000000000000000001", params[0].to, params[0].data ?? params[0].input, false, params[0].gas);
      case "eth_getLogs": return logsFor(params[0]);
      case "eth_getTransactionReceipt": return s.receipts[params[0]] ?? null;
      case "eth_getTransactionByHash": {
        const r = s.receipts[params[0]];
        return r ? { hash: r.transactionHash, blockNumber: r.blockNumber, blockHash: r.blockHash, from: r.from, to: r.to, input: "0x", value: "0x0", nonce: "0x0", gas: "0x30d40", gasPrice: "0x3b9aca00", transactionIndex: "0x0", type: "0x2", chainId: "0x1", v: "0x0", r: "0x1", s: "0x1" } : null;
      }
    }
    throw Object.assign(new Error(`fakechain: unsupported ${method}`), { rpc: { code: -32601, message: `unsupported ${method}` } });
  }

  /** Requests the injected test wallet receives. */
  function wallet(method, params = [], account) {
    switch (method) {
      case "eth_accounts": return s.authorized ? [account] : [];
      case "eth_requestAccounts": s.authorized = true; return [account];
      case "eth_chainId": return s.walletChain;
      case "wallet_getCapabilities": throw Object.assign(new Error("not supported"), { rpc: { code: 4200, message: "Method not supported" } });
      case "wallet_switchEthereumChain": {
        const id = params[0].chainId;
        if (!s.knownChains.has(id)) throw Object.assign(new Error("unknown"), { rpc: { code: 4902, message: "Unrecognized chain ID" } });
        s.walletChain = id;
        return null;
      }
      case "wallet_addEthereumChain": s.added.push(params[0]); s.knownChains.add(params[0].chainId); return null;
      case "wallet_requestPermissions": return [{ parentCapability: "eth_accounts" }];
      case "eth_sendTransaction": {
        if (s.rejectNext) { s.rejectNext = false; throw Object.assign(new Error("rejected"), { rpc: { code: 4001, message: "User rejected the request." } }); }
        if (s.walletChain !== "0x1") throw Object.assign(new Error("chain"), { rpc: { code: -32000, message: "wrong chain" } });
        const tx = params[0];
        const { functionName, args } = decodeFunctionData({ abi, data: tx.data ?? tx.input });
        s.block += 1n; s.nonce += 1;
        const hash = keccak256(toHex(`tx${s.nonce}`));
        const before = s.logs.length;
        // No gas field: the wallet fills in its own estimate (eth_estimateGas answers 200,000 here).
        const gasUsed = s.walletGas ?? (tx.gas ? BigInt(tx.gas) : 200_000n);
        exec(tx.from, tx.to, tx.data ?? tx.input, true, gasUsed);
        const emitted = s.logs.slice(before);
        for (const l of emitted) { l.block = s.block; l.tx = hash; }
        s.sent.push({ to: lc(tx.to), functionName, args, hash, gas: tx.gas ? BigInt(tx.gas) : null, gasUsed });
        s.receipts[hash] = {
          transactionHash: hash, blockNumber: toHex(s.block), blockHash: keccak256(toHex(s.block)), status: "0x1",
          from: lc(tx.from), to: lc(tx.to), gasUsed: "0x30d40", cumulativeGasUsed: "0x30d40", effectiveGasPrice: "0x3b9aca00",
          logs: emitted.map((l, i) => ({
            address: lc(prAddress), topics: encodeEventTopics({ abi: prAbi, eventName: l.eventName, args: l.args }), data: "0x",
            blockNumber: toHex(s.block), transactionHash: hash, transactionIndex: "0x0", blockHash: keccak256(toHex(s.block)),
            logIndex: toHex(i), removed: false,
          })),
          logsBloom: "0x" + "0".repeat(512), transactionIndex: "0x0", type: "0x2", contractAddress: null,
        };
        return hash;
      }
    }
    return rpc(method, params);
  }

  return { s, rpc, wallet, sub, parseUnits, encodeAbiParameters };
}
