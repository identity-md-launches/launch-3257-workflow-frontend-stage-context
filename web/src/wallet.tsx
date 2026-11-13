import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";
import { WALLET_ICONS } from "./wallet-icons";
import { OPEN_IN, isMobileBrowser } from "./open-in";
import { useDeployment } from "./deployment";
import { short } from "./format";

type SheetCtx = { openSheet: () => void };
const Ctx = createContext<SheetCtx>({ openSheet: () => {} });
export const useConnectSheet = () => useContext(Ctx);

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** True when a wallet is connected on the deployment's chain. */
export function useWalletReady() {
  const dep = useDeployment();
  const { address, isConnected, chainId } = useAccount();
  return { address, isConnected, wrongChain: isConnected && chainId !== dep.chain.id, ready: isConnected && chainId === dep.chain.id };
}

/**
 * Switch the wallet to the deployment chain: wallet_switchEthereumChain, and when the wallet does not
 * know the chain (4902 or an "unrecognized chain" error), wallet_addEthereumChain with the manifest's
 * walletAddChain parameters, then switch again.
 */
export function useSwitchToChain() {
  const dep = useDeployment();
  const { connector } = useAccount();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!connector) return;
    setPending(true);
    setError(null);
    const hex = dep.walletAddChain.chainId;
    try {
      const provider = (await connector.getProvider()) as { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (e) {
        const err = e as { code?: number; data?: { originalError?: { code?: number } }; message?: string };
        const code = err.code ?? err.data?.originalError?.code;
        if (code === 4902 || /unrecognized|unknown chain|not added|4902/i.test(err.message ?? "")) {
          await provider.request({ method: "wallet_addEthereumChain", params: [dep.walletAddChain] });
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
        } else throw e;
      }
    } catch (e) {
      const err = e as { code?: number; message?: string };
      setError(err.code === 4001 ? "You declined the switch in your wallet." : `The wallet could not switch: ${err.message ?? "unknown error"}`);
    } finally {
      setPending(false);
    }
  };
  return { run, pending, error };
}

/** The one connect control: Connect, then the short address with Disconnect, or Switch to <chain>. */
export function WalletControl() {
  const dep = useDeployment();
  const { address, wrongChain } = useWalletReady();
  const { disconnect } = useDisconnect();
  const { openSheet } = useConnectSheet();
  const sw = useSwitchToChain();
  if (address && wrongChain)
    return (
      <div className="wallet-switch">
        <button className="btn btn-ink" onClick={sw.run} disabled={sw.pending}>
          {sw.pending ? "Switching…" : `Switch to ${dep.chain.name}`}
        </button>
        {sw.error && <p className="note error" role="alert">{sw.error}</p>}
      </div>
    );
  if (address)
    return (
      <button className="btn btn-quiet wallet-btn" onClick={() => disconnect()} title={address}>
        <span className="mono">{short(address)}</span> · Disconnect
      </button>
    );
  return <button className="btn btn-ink wallet-btn" onClick={openSheet}>Connect</button>;
}

/** Holds the sheet's open state so any action button can open it. */
export function ConnectSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Ctx.Provider value={{ openSheet: () => setOpen(true) }}>
      {children}
      {open && <ConnectSheet onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

function ConnectSheet({ onClose }: { onClose: () => void }) {
  const mobile = isMobileBrowser();
  const { isConnected } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && sheet.current) {
        const f = sheet.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    addEventListener("keydown", onKey);
    sheet.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
    const back = opener.current;
    return () => { removeEventListener("keydown", onKey); (back as HTMLElement | null)?.focus?.(); };
  }, [onClose]);
  useEffect(() => { if (isConnected) onClose(); }, [isConnected, onClose]);

  // EIP-6963 names each installed extension; the generic injected row is only for a browser where
  // discovery found nothing, and then it is called what it is.
  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")]
    .filter((c) => !(c.id === "injected" && named));
  const label = (c: Connector) => (c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name);
  const icon = (c: Connector) => c.icon ?? (WALLET_ICONS[c.id] ? svgUrl(WALLET_ICONS[c.id]!) : undefined);
  const rejected = error && /reject|denied|cancel/i.test(error.message);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id="sheet-title">Connect a wallet</h2>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {mobile && OPEN_IN.map((w) => (
          <a key={w.id} className="row" href={w.href(location.href)}>
            <span className="ic">{WALLET_ICONS[w.id] && <img width={28} height={28} src={svgUrl(WALLET_ICONS[w.id]!)} alt="" />}</span>
            <span>Open in {w.name}</span>
          </a>
        ))}
        {listed.filter((c) => !mobile || c.type !== "injected").map((c) => (
          <button key={c.uid} className="row" onClick={() => { reset(); connect({ connector: c }); }} disabled={isPending}>
            <span className="ic">{icon(c) && <img width={28} height={28} src={icon(c)} alt="" />}</span>
            <span>{label(c)}{isPending && variables?.connector === c ? " · opening…" : ""}</span>
          </button>
        ))}
        {error && <p className="note error" role="alert">{rejected ? "The wallet declined the connection. Try again when ready." : error.message.split("\n")[0]}</p>}
      </div>
    </div>
  );
}
