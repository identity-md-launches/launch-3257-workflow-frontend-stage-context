import { useState } from "react";
import { useConfig } from "wagmi";
import { getAddress, type Address } from "viem";
import { DAILY_SITE_URL, MAX_DELIVER_BATCH, SOURCE_REPO_URL, SUBSCRIBE_EDITIONS, erc20Abi } from "./config";
import { useDeployment } from "./deployment";
import { useAccountState, useCore, useHistory, useLastDelivery, type AccountState, type Copy, type Core } from "./data";
import { ConnectSheetProvider, WalletControl, useConnectSheet, useWalletReady } from "./wallet";
import { useTx, type TxState } from "./tx";
import { canBatch, sendBatch, sendOne, type Call } from "./actions";
import { amount, editionDate, moment } from "./format";

export function App() {
  return (
    <ConnectSheetProvider>
      <Page />
    </ConnectSheetProvider>
  );
}

function Page() {
  const core = useCore();
  const c = core.data;
  const account = useAccountState(c);
  const refresh = () => { void core.refetch(); void account.refetch(); };
  return (
    <div className="page">
      <header className="masthead">
        <a className="wordmark" href="./">Paper Route</a>
        <WalletControl />
      </header>
      {c && !c.verified && <p className="banner" role="alert">Transactions are off. {c.verifyNote}</p>}
      {core.isError && <p className="banner" role="alert">The public RPC did not answer, so contract state is not shown. It retries every 20 seconds.</p>}
      <main className="front">
        <section className="lead" aria-labelledby="headline">
          <h1 id="headline">The IMD Daily, delivered.</h1>
          <p className="dek">Pay 5 IMD once. A copy of each day's edition is minted to your wallet, 40 editions in a row.</p>
        </section>
        <Cover core={c} loading={core.isPending} />
        <SubscribePanel core={c} account={account.data} onDone={refresh} />
        <DeliverPanel core={c} loading={core.isPending} onDone={refresh} />
      </main>
      <Footer core={c} />
    </div>
  );
}

function Cover({ core, loading }: { core?: Core; loading: boolean }) {
  const issue = core?.latest;
  return (
    <figure className="cover">
      {issue ? (
        <>
          <a href={DAILY_SITE_URL} target="_blank" rel="noopener noreferrer" className="cover-link">
            <img src={issue.coverURL} alt={`Cover of ${issue.title}. Opens The IMD Daily's site.`} width={600} height={849} />
          </a>
          <figcaption>
            <a href={DAILY_SITE_URL} target="_blank" rel="noopener noreferrer">{issue.title}</a>
            <span className="meta">{core!.open ? `On sale until ${moment(issue.closesAt)}` : `Sale closed ${moment(issue.closesAt)}`}</span>
          </figcaption>
        </>
      ) : (
        <div className="cover-empty">{loading ? "Reading the latest cover…" : "The IMD Daily has not published an issue yet."}</div>
      )}
    </figure>
  );
}

function TxStatus({ state, explorer }: { state: TxState; explorer: string }) {
  if (state.status === "idle") return null;
  return (
    <div className="tx" aria-live="polite">
      {state.steps.length > 0 && (
        <ol className="steps">
          {state.steps.map((s, i) => (
            <li key={i} data-state={s.state}>
              <span>{s.label}: {s.state === "wallet" ? "confirm in your wallet" : s.state === "pending" ? "pending" : "confirmed"}</span>
              {s.hash && <> <a href={`${explorer}/tx/${s.hash}`} target="_blank" rel="noopener noreferrer">View transaction</a></>}
            </li>
          ))}
        </ol>
      )}
      {state.status !== "busy" && state.message && (
        <p className={state.status === "error" ? "note error" : "note ok"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>
      )}
    </div>
  );
}

/** Approve exactly `cost` (when the allowance is short) and call subscribe(40): one batched confirmation where possible. */
function useSubscribe(core: Core | undefined, account: AccountState | undefined, onDone: () => void) {
  const dep = useDeployment();
  const config = useConfig();
  const { address } = useWalletReady();
  const tx = useTx();
  const cost = core ? SUBSCRIBE_EDITIONS * core.editionPrice : 0n;
  const go = () =>
    tx.run(async (h) => {
      if (!core || !account || !address) throw new Error("Wallet state is still loading.");
      const chainId = dep.chain.id;
      const sub: Call = { address: dep.paperRoute.address, abi: dep.paperRoute.abi, functionName: "subscribe", args: [SUBSCRIBE_EDITIONS] };
      const approve: Call = { address: core.imd, abi: erc20Abi, functionName: "approve", args: [dep.paperRoute.address, cost] };
      if (account.allowance >= cost) {
        await sendOne(config, h, `Subscribe for ${amount(cost, core.decimals)} IMD`, address, chainId, sub);
      } else if (await canBatch(config, address, chainId)) {
        await sendBatch(config, h, `Approve ${amount(cost, core.decimals)} IMD and subscribe`, address, chainId, [approve, sub]);
      } else {
        await sendOne(config, h, `Step 1 of 2. Approve ${amount(cost, core.decimals)} IMD`, address, chainId, approve);
        await sendOne(config, h, "Step 2 of 2. Subscribe", address, chainId, sub);
      }
      onDone();
      return `Subscribed. ${SUBSCRIBE_EDITIONS} editions were added to your subscription.`;
    });
  return { tx, go, cost };
}

function SubscribePanel({ core, account, onDone }: { core?: Core; account?: AccountState; onDone: () => void }) {
  const dep = useDeployment();
  const config = useConfig();
  const { address, isConnected, wrongChain, ready } = useWalletReady();
  const { openSheet } = useConnectSheet();
  const { tx, go, cost } = useSubscribe(core, account, onDone);
  const cancelTx = useTx();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const history = useHistory(core, account?.lastIssue);
  const dec = core?.decimals ?? 18;
  const subscribed = !!account && account.editionsLeft > 0n;
  const short = !!account && !!core && account.balance < cost;
  const busy = tx.state.status === "busy" || cancelTx.state.status === "busy";
  const canAct = ready && !!core?.verified && !!account && !short && !busy;
  const refund = account && core ? account.editionsLeft * core.editionPrice : 0n;

  const doCancel = () =>
    cancelTx.run(async (h) => {
      setConfirmCancel(false);
      await sendOne(config, h, `Cancel and refund ${amount(refund, dec)} IMD`, address!, dep.chain.id, {
        address: dep.paperRoute.address, abi: dep.paperRoute.abi, functionName: "cancel", args: [],
      });
      onDone();
      return `Cancelled. ${amount(refund, dec)} IMD was refunded to your wallet.`;
    });

  const reason = !isConnected ? null
    : wrongChain ? `Switch to ${dep.chain.name} at the top of the page to continue.`
    : core && !core.verified ? "Transactions are off until the contract is verified on this chain."
    : !account ? "Reading your wallet…"
    : short ? `This needs ${amount(cost, dec)} IMD. Your wallet holds ${amount(account.balance, dec)} IMD.`
    : null;

  const steps = !account || !core ? null
    : account.allowance >= cost ? "One confirmation: subscribe."
    : `Your wallet asks to approve ${amount(cost, dec)} IMD for Paper Route, then to subscribe. Wallets that batch calls ask once.`;

  return (
    <section className="panel subscribe" aria-labelledby="subscribe-h">
      {subscribed ? (
        <>
          <h2 id="subscribe-h">Your subscription</h2>
          <p className="figure"><span className="num">{account!.editionsLeft.toString()}</span> editions left</p>
          <p className="note">
            {account!.lastDeliveredAt > 0n ? `Last delivered ${moment(account!.lastDeliveredAt)}. ` : "No copy delivered yet. "}
            Your wallet holds <span className="mono">{amount(account!.balance, dec)}</span> IMD.
          </p>
          <div className="actions">
            <button className="btn btn-red" onClick={go} disabled={!canAct}>Add 40 more for {amount(cost, dec)} IMD</button>
            {!confirmCancel ? (
              <button className="btn btn-quiet" onClick={() => setConfirmCancel(true)} disabled={!ready || busy}>Cancel and refund {amount(refund, dec)} IMD</button>
            ) : (
              <span className="confirm">
                <span>Refund {amount(refund, dec)} IMD and end deliveries?</span>
                <button className="btn btn-ink" onClick={doCancel}>Yes, cancel</button>
                <button className="btn btn-quiet" onClick={() => setConfirmCancel(false)}>Keep it</button>
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <h2 id="subscribe-h">Subscribe</h2>
          <button className="btn btn-red btn-main" onClick={isConnected ? go : openSheet} disabled={isConnected && !canAct}>
            Subscribe for 5 IMD
          </button>
          <p className="note">{!isConnected ? "Connect a wallet to subscribe. 40 editions, one a day." : steps}</p>
        </>
      )}
      {reason && <p className="note warn">{reason}</p>}
      <TxStatus state={tx.state} explorer={dep.file.network.explorer} />
      <TxStatus state={cancelTx.state} explorer={dep.file.network.explorer} />
      <details className="pays">
        <summary>What the 5 IMD pays for</summary>
        {core ? (
          <p>
            {amount(SUBSCRIBE_EDITIONS * core.copyPrice, dec)} IMD buys {SUBSCRIBE_EDITIONS.toString()} copies at the paper's own price of{" "}
            {amount(core.copyPrice, dec)} IMD. {amount(SUBSCRIBE_EDITIONS * core.tip, dec)} IMD tips the deliveries, {amount(core.tip, dec)} IMD
            each, to whoever presses Deliver. Cancel any time to get back what is unused.
          </p>
        ) : <p>Reading the prices from the contract…</p>}
      </details>
      {account && account.lastIssue > 0n && <Copies copies={history.data?.copies} source={history.data?.source} loading={history.isPending} error={history.isError} />}
    </section>
  );
}

function Copies({ copies, source, loading, error }: { copies?: Copy[]; source?: "events" | "balances"; loading: boolean; error: boolean }) {
  return (
    <div className="copies">
      <h3>Delivered copies</h3>
      {error ? <p className="note">Your delivery history could not be read from the RPC.</p>
        : loading || !copies ? <p className="note">Reading your deliveries…</p>
        : (
          <ul>
            {copies.map((c) => (
              <li key={c.id.toString()}>
                <a href={c.coverURL} target="_blank" rel="noopener noreferrer"><img src={c.coverURL} alt={`Cover of ${c.title}`} width={120} height={170} loading="lazy" /></a>
                <span>{editionDate(c.editorialDate)}</span>
              </li>
            ))}
          </ul>
        )}
      {source === "balances" && <p className="note">The RPC refused the event history, so these are the issues in your wallet up to the last Paper Route delivery.</p>}
    </div>
  );
}

function DeliverPanel({ core, loading, onDone }: { core?: Core; loading: boolean; onDone: () => void }) {
  const dep = useDeployment();
  const config = useConfig();
  const { address, isConnected, wrongChain, ready } = useWalletReady();
  const { openSheet } = useConnectSheet();
  const tx = useTx();
  const last = useLastDelivery(core);
  const dec = core?.decimals ?? 18;
  const batch: Address[] = core ? core.waiting.slice(0, MAX_DELIVER_BATCH) : [];
  const earn = core ? BigInt(batch.length) * core.tip : 0n;
  const busy = tx.state.status === "busy";

  const deliver = () =>
    tx.run(async (h) => {
      const result = (await sendOne(config, h, `Deliver to ${batch.length} subscriber${batch.length === 1 ? "" : "s"}`, address!, dep.chain.id, {
        address: dep.paperRoute.address, abi: dep.paperRoute.abi, functionName: "deliver", args: [core!.latest!.id, batch],
      })) as Address[];
      onDone();
      void last.refetch();
      const n = BigInt(result.length);
      return `Delivered ${n} cop${n === 1n ? "y" : "ies"}. ${amount(n * core!.tip, dec)} IMD in tips was paid to your wallet.`;
    });

  let body;
  if (!core) body = <p className="note">{loading ? "Reading today's edition…" : "Delivery state is unavailable."}</p>;
  else if (!core.latest || !core.open)
    body = <p className="note">No edition is on sale right now. Delivery opens when The IMD Daily publishes the next issue.</p>;
  else if (core.waiting.length === 0)
    body = last.data ? (
      <p className="note ok">
        Today's edition was delivered at {moment(last.data.at)}.{" "}
        <a href={`${dep.file.network.explorer}/tx/${last.data.txHash}`} target="_blank" rel="noopener noreferrer">View transaction</a>
      </p>
    ) : (
      <p className="note">
        {last.isPending ? "Checking today's deliveries…"
          : last.isError ? "Nobody is waiting for today's edition. The RPC refused the delivery history, so its time is not shown."
          : core.subscriberCount === 0n ? "Nobody is subscribed yet, so nobody is waiting for today's edition."
          : "Nobody is waiting for today's edition."}
      </p>
    );
  else
    body = (
      <>
        <dl className="stats">
          <div><dt>Waiting</dt><dd className="mono">{core.waiting.length}</dd></div>
          <div><dt>Tips on offer</dt><dd className="mono">{amount(BigInt(core.waiting.length) * core.tip, dec)} IMD</dd></div>
        </dl>
        <button className="btn btn-ink btn-main" onClick={isConnected ? deliver : openSheet} disabled={isConnected && (!ready || !core.verified || busy)}>
          Deliver today's edition and earn {amount(earn, dec)} IMD
        </button>
        <p className="note">
          {core.waiting.length > MAX_DELIVER_BATCH ? `One transaction serves ${MAX_DELIVER_BATCH}; press again for the rest. ` : ""}
          Anyone can deliver. You pay the network fee; the tips come from the subscribers' prepaid IMD.
        </p>
        {wrongChain && <p className="note warn">Switch to {dep.chain.name} at the top of the page to deliver.</p>}
      </>
    );

  return (
    <section className="panel deliver" aria-labelledby="deliver-h">
      <h2 id="deliver-h">Deliver</h2>
      {core?.latest && core.open && <p className="note">{core.latest.title}. On sale until {moment(core.latest.closesAt)}.</p>}
      {body}
      <TxStatus state={tx.state} explorer={dep.file.network.explorer} />
    </section>
  );
}

function Footer({ core }: { core?: Core }) {
  const dep = useDeployment();
  const addr = getAddress(dep.paperRoute.address);
  const ex = dep.file.network.explorer;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <footer className="foot">
      <p className="disclaimer">Unofficial. Not run by The IMD Daily.</p>
      <div className="addr">
        <span>PaperRoute</span>
        <code className="mono">{addr}</code>
        <span className="links">
          <button className="btn btn-quiet btn-small" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
          <a href={`${ex}/address/${addr}`} target="_blank" rel="noopener noreferrer">Etherscan</a>
          <a href={SOURCE_REPO_URL} target="_blank" rel="noopener noreferrer">Source</a>
        </span>
        <span className="sr-only" aria-live="polite">{copied ? "Address copied" : ""}</span>
      </div>
      <div className="how">
        <h2>How it works</h2>
        <ol>
          <li>You prepay 0.125 IMD an edition; 5 IMD buys 40.</li>
          <li>Each day anyone can press Deliver to mint that day's issue to every subscriber who is due.</li>
          <li>Each copy pays The IMD Daily 0.1 IMD and tips the deliverer 0.025 IMD.</li>
          <li>Cancel any time and the contract refunds your unused editions in full.</li>
        </ol>
      </div>
      {core && (
        <p className="note">
          Also read: <a href={`${ex}/token/${core.imd}`} target="_blank" rel="noopener noreferrer">IMD token</a> ·{" "}
          <a href={`${ex}/address/${core.daily}`} target="_blank" rel="noopener noreferrer">The IMD Daily collection</a> · Ethereum mainnet, chain {dep.chain.id}.
        </p>
      )}
    </footer>
  );
}
