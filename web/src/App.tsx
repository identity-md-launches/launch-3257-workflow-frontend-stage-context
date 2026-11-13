import { useId, useState } from "react";
import { useConfig } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";
import {
  DAILY_SITE_URL, DAILY_X_HANDLE, DAILY_X_URL, DEFAULT_EDITIONS, EDITION_PICKS, MAX_DELIVER_BATCH, MAX_EDITIONS,
  SOURCE_REPO_URL, SUBSCRIBER_ROWS, erc20Abi,
} from "./config";
import { useDeployment } from "./deployment";
import {
  useAccountState, useCore, useEnsNames, useHistory, useLastDelivery, useSubscribers,
  type AccountState, type Copy, type Core,
} from "./data";
import { ConnectSheetProvider, WalletControl, useConnectSheet, useWalletReady } from "./wallet";
import { useTx, type TxState } from "./tx";
import { canBatch, sendBatch, sendDeliver, sendOne, type Call } from "./actions";
import { amount, count, day, editionDate, exact, moment, plural, short } from "./format";

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
  const qc = useQueryClient();
  const refresh = () => {
    void core.refetch();
    void account.refetch();
    void qc.invalidateQueries({ queryKey: ["subscribers"] });
  };
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
          <p className="dek">Pay once. A copy of each day's edition is minted to your wallet, for as many editions as you choose.</p>
        </section>
        <Cover core={c} loading={core.isPending} />
        <SubscribePanel core={c} account={account.data} onDone={refresh} />
        <DeliverPanel core={c} loading={core.isPending} onDone={refresh} />
        <Subscribers />
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
      <p className="paper-links">
        <a href={DAILY_SITE_URL} target="_blank" rel="noopener noreferrer">Read the paper</a>
        <a href={DAILY_X_URL} target="_blank" rel="noopener noreferrer">{DAILY_X_HANDLE}</a>
      </p>
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
              <span>{s.label}: {s.state === "wallet" ? "confirm in your wallet" : s.state === "pending" ? "pending" : s.state === "reverted" ? "reverted" : "confirmed"}</span>
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

/** Parses the Editions field: a whole number from 1 to MAX_EDITIONS, else null. */
function parseEditions(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = BigInt(t);
  return n >= 1n && n <= MAX_EDITIONS ? n : null;
}

/** One row: quick picks and a field for any whole number. Picking or typing updates everything at once. */
function EditionsPicker({ text, onChange, invalid, msgId }: { text: string; onChange: (t: string) => void; invalid: boolean; msgId: string }) {
  const id = useId();
  const n = parseEditions(text);
  return (
    <fieldset className="editions">
      <legend>Editions</legend>
      <div className="picks">
        {EDITION_PICKS.map((p) => (
          <button key={p.toString()} type="button" className="pick" aria-pressed={n === p} onClick={() => onChange(p.toString())}>
            {p.toString()}
          </button>
        ))}
        <label className="sr-only" htmlFor={id}>Any number of editions</label>
        <input
          id={id} className="count" type="text" inputMode="numeric" autoComplete="off" spellCheck={false}
          value={text} onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined} aria-describedby={invalid ? msgId : undefined}
        />
      </div>
    </fieldset>
  );
}

/** Approve exactly the pick's price (when the allowance is short) and call subscribe(N): one batched confirmation where possible. */
function useSubscribe(core: Core | undefined, account: AccountState | undefined, editions: bigint | null, onDone: () => void) {
  const dep = useDeployment();
  const config = useConfig();
  const { address } = useWalletReady();
  const tx = useTx();
  const cost = core && editions ? editions * core.editionPrice : 0n;
  const go = (after?: () => void) =>
    tx.run(async (h) => {
      if (!core || !account || !address || !editions) throw new Error("Wallet state is still loading.");
      const n = editions;
      const price = cost;
      const chainId = dep.chain.id;
      const dec = core.decimals;
      const sub: Call = { address: dep.paperRoute.address, abi: dep.paperRoute.abi, functionName: "subscribe", args: [n] };
      const approve: Call = { address: core.imd, abi: erc20Abi, functionName: "approve", args: [dep.paperRoute.address, price] };
      if (account.allowance >= price) {
        await sendOne(config, h, `Subscribe for ${exact(price, dec)} IMD`, address, chainId, sub);
      } else if (await canBatch(config, address, chainId)) {
        await sendBatch(config, h, `Approve ${exact(price, dec)} IMD and subscribe`, address, chainId, [approve, sub]);
      } else {
        await sendOne(config, h, `Step 1 of 2. Approve ${exact(price, dec)} IMD`, address, chainId, approve);
        await sendOne(config, h, `Step 2 of 2. Subscribe for ${plural(n, "edition", "editions")}`, address, chainId, sub);
      }
      onDone();
      after?.();
      return `Subscribed. ${plural(n, "edition was", "editions were")} added to your subscription.`;
    });
  return { tx, go, cost };
}

function SubscribePanel({ core, account, onDone }: { core?: Core; account?: AccountState; onDone: () => void }) {
  const dep = useDeployment();
  const config = useConfig();
  const { address, isConnected, wrongChain, ready } = useWalletReady();
  const { openSheet } = useConnectSheet();
  const [text, setText] = useState(DEFAULT_EDITIONS.toString());
  const [adding, setAdding] = useState(false);
  const editions = parseEditions(text);
  const { tx, go, cost } = useSubscribe(core, account, editions, onDone);
  const cancelTx = useTx();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const history = useHistory(core, account?.lastIssue);
  const msgId = useId();
  const dec = core?.decimals ?? 18;
  const subscribed = !!account && account.editionsLeft > 0n;
  const pickerOpen = !subscribed || adding;
  const short = pickerOpen && !!account && !!core && !!editions && account.balance < cost;
  const busy = tx.state.status === "busy" || cancelTx.state.status === "busy";
  const canAct = ready && !!core?.verified && !!account && !!editions && !short && !busy;
  const refund = account && core ? account.editionsLeft * core.editionPrice : 0n;
  const price = core && editions ? exact(cost, dec) : null;

  const doCancel = () =>
    cancelTx.run(async (h) => {
      setConfirmCancel(false);
      setAdding(false);
      await sendOne(config, h, `Cancel and refund ${exact(refund, dec)} IMD`, address!, dep.chain.id, {
        address: dep.paperRoute.address, abi: dep.paperRoute.abi, functionName: "cancel", args: [],
      });
      onDone();
      return `Cancelled. ${exact(refund, dec)} IMD was refunded to your wallet.`;
    });

  // One line at most explains why the button is off; the balance line shows only while the picker is open.
  const reason = !editions && pickerOpen ? null
    : !isConnected ? null
    : wrongChain ? `Switch to ${dep.chain.name} at the top of the page to continue.`
    : core && !core.verified ? "Transactions are off until the contract is verified on this chain."
    : !account ? "Reading your wallet…"
    : short ? `This needs ${exact(cost, dec)} IMD. Your wallet holds ${amount(account.balance, dec)} IMD.`
    : null;

  const steps = !account || !core || !editions || short ? null
    : account.allowance >= cost ? "One confirmation: subscribe."
    : `Your wallet asks to approve ${exact(cost, dec)} IMD for Paper Route, then to subscribe. Wallets that batch calls ask once.`;

  const picker = (
    <>
      <EditionsPicker text={text} onChange={setText} invalid={!editions} msgId={msgId} />
      {!editions && <p className="note warn" id={msgId} role="alert">Enter a whole number of editions, from 1 to {count(MAX_EDITIONS)}.</p>}
    </>
  );

  return (
    <section className="panel subscribe" aria-labelledby="subscribe-h">
      {subscribed ? (
        <>
          <h2 id="subscribe-h">Your subscription</h2>
          <p className="figure"><span className="num">{count(account!.editionsLeft)}</span> editions left</p>
          <p className="note">
            {account!.lastDeliveredAt > 0n ? `Last delivered ${moment(account!.lastDeliveredAt)}. ` : "No copy delivered yet. "}
            Your wallet holds <span className="mono">{amount(account!.balance, dec)}</span> IMD.
          </p>
          {adding && (
            <div className="adder">
              {picker}
              <button className="btn btn-red btn-main" onClick={() => go(() => setAdding(false))} disabled={!canAct}>
                {editions !== null && price ? `Add ${count(editions)} for ${price} IMD` : "Add editions"}
              </button>
              {editions !== null && <p className="note">{plural(editions, "edition", "editions")}, one a day.{steps ? ` ${steps}` : ""}</p>}
            </div>
          )}
          <div className="actions">
            {adding ? (
              <button className="btn btn-quiet" onClick={() => setAdding(false)} disabled={busy}>Close</button>
            ) : (
              <button className="btn btn-red" onClick={() => { setAdding(true); setConfirmCancel(false); }} disabled={!ready || busy}>Add editions</button>
            )}
            {!confirmCancel ? (
              <button className="btn btn-quiet" onClick={() => setConfirmCancel(true)} disabled={!ready || busy}>Cancel and refund {exact(refund, dec)} IMD</button>
            ) : (
              <span className="confirm">
                <span>Refund {exact(refund, dec)} IMD and end deliveries?</span>
                <button className="btn btn-ink" onClick={doCancel}>Yes, cancel</button>
                <button className="btn btn-quiet" onClick={() => setConfirmCancel(false)}>Keep it</button>
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <h2 id="subscribe-h">Subscribe</h2>
          {picker}
          <button className="btn btn-red btn-main" onClick={isConnected ? () => go() : openSheet} disabled={!editions || (isConnected && !canAct)}>
            {price ? `Subscribe for ${price} IMD` : "Subscribe"}
          </button>
          {editions !== null && <p className="note">{plural(editions, "edition", "editions")}, one a day.</p>}
          {editions !== null && <p className="note">{!isConnected ? "Connect a wallet to subscribe." : steps}</p>}
        </>
      )}
      {reason && <p className="note warn">{reason}</p>}
      <TxStatus state={tx.state} explorer={dep.file.network.explorer} />
      <TxStatus state={cancelTx.state} explorer={dep.file.network.explorer} />
      {pickerOpen && editions !== null && core && price && (
        <details className="pays">
          <summary>What the {price} IMD pays for</summary>
          {core ? (
            <p>
              {exact(editions * core.copyPrice, dec)} IMD buys {plural(editions, "copy", "copies")} at the paper's own price of{" "}
              {exact(core.copyPrice, dec)} IMD. {exact(editions * core.tip, dec)} IMD tips the deliveries, {exact(core.tip, dec)} IMD
              each, to whoever presses Deliver. Cancel any time to get back what is unused.
            </p>
          ) : <p>Reading the prices from the contract…</p>}
        </details>
      )}
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
      let delivered: number;
      try {
        ({ delivered } = await sendDeliver(
          config, h, address!, dep.chain.id,
          { pr: dep.paperRoute, multicall3: dep.multicall3!, imd: core!.imd, tip: core!.tip },
          core!.latest!.id, batch,
        ));
      } finally {
        onDone();
        void last.refetch();
      }
      // Cannot happen through Multicall3 (the tip transfer would revert), but the receipt is the authority.
      if (delivered === 0) throw new Error("Nothing was delivered and no tip was paid. The transaction minted no copy.");
      return `Delivered ${plural(delivered, "copy", "copies")}. ${exact(BigInt(delivered) * core!.tip, dec)} IMD in tips was paid to your wallet.`;
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
        <button className="btn btn-ink btn-main" onClick={isConnected ? deliver : openSheet} disabled={isConnected && (!ready || !core.verified || !core.deliverReady || busy)}>
          Deliver today's edition and earn {amount(earn, dec)} IMD
        </button>
        <p className="note">
          {core.waiting.length > MAX_DELIVER_BATCH ? `One transaction serves ${MAX_DELIVER_BATCH}; press again for the rest. ` : ""}
          Anyone can deliver. You pay the network fee; the tips come from the subscribers' prepaid IMD.
          {" "}Your wallet shows a call to{" "}
          <a href={`${dep.file.network.explorer}/address/${dep.multicall3 ?? ""}`} target="_blank" rel="noopener noreferrer">Multicall3</a>,
          which delivers and passes the tips to you in the same transaction.
        </p>
        {!core.deliverReady && <p className="note warn">Multicall3 was not found on {dep.chain.name}, so delivering is off.</p>}
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

function Subscribers() {
  const dep = useDeployment();
  const { address } = useWalletReady();
  const subs = useSubscribers();
  const [all, setAll] = useState(false);
  const rows = subs.data?.rows ?? [];
  const shown = all ? rows : rows.slice(0, SUBSCRIBER_ROWS);
  const names = useEnsNames(subs.data ? shown.map((r) => r.address) : []);
  const ex = dep.file.network.explorer;
  const me = address?.toLowerCase();
  return (
    <section className="panel subscribers" aria-labelledby="subscribers-h">
      <h2 id="subscribers-h">Subscribers{subs.data ? `: ${count(subs.data.count)}` : ""}</h2>
      {!subs.data ? (
        <p className="note">{subs.isError ? "The public RPC did not answer, so the list is not shown. It retries every 20 seconds." : "Reading the subscribers…"}</p>
      ) : rows.length === 0 ? (
        <p className="note">Nobody is subscribed yet.</p>
      ) : (
        <>
          <p className="note">{plural(subs.data.reserved, "edition", "editions")} prepaid in total.</p>
          <table className="subs">
            <thead>
              <tr><th scope="col">Subscriber</th><th scope="col" className="n">Editions left</th><th scope="col">Last delivered</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const name = names.data?.[r.address.toLowerCase()];
                const mine = r.address.toLowerCase() === me;
                return (
                  <tr key={r.address} className={mine ? "mine" : undefined}>
                    <td className="who">
                      <a href={`${ex}/address/${getAddress(r.address)}`} target="_blank" rel="noopener noreferrer" title={getAddress(r.address)}
                        className={name ? undefined : "mono"}>{name ?? short(r.address)}</a>
                      {mine && <span className="you">you</span>}
                    </td>
                    <td className="n mono">{count(r.editionsLeft)}</td>
                    <td>{r.lastDeliveredAt > 0n ? day(r.lastDeliveredAt) : "none yet"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!all && rows.length > SUBSCRIBER_ROWS && (
            <button className="btn btn-quiet btn-small show-all" onClick={() => setAll(true)}>Show all {count(rows.length)}</button>
          )}
        </>
      )}
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
      <p className="paper-line">
        The paper itself: <a href={DAILY_SITE_URL} target="_blank" rel="noopener noreferrer">The IMD Daily</a> ·{" "}
        <a href={DAILY_X_URL} target="_blank" rel="noopener noreferrer">{DAILY_X_HANDLE}</a>
      </p>
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
          <li>You prepay 0.125 IMD an edition, for as many editions as you like.</li>
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
