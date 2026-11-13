import { formatUnits, getAddress } from "viem";

/** Integer token amount to a short decimal string; never floating point. */
export function amount(value: bigint, decimals = 18): string {
  const s = formatUnits(value, decimals);
  if (!s.includes(".")) return Number(s) >= 1000 ? BigInt(s).toLocaleString("en-US") : s;
  const [i, f] = s.split(".");
  const whole = BigInt(i!).toLocaleString("en-US");
  const frac = f!.slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
/** Exact token amount: integer math, no rounding, trailing zeros dropped, thousands grouped. */
export function exact(value: bigint, decimals = 18): string {
  const [i, f] = formatUnits(value, decimals).split(".");
  const whole = BigInt(i!).toLocaleString("en-US");
  return f ? `${whole}.${f}` : whole;
}
export const count = (n: bigint | number) => BigInt(n).toLocaleString("en-US");
export const plural = (n: bigint | number, one: string, many: string) => `${count(n)} ${BigInt(n) === 1n ? one : many}`;
export const short = (a: string) => {
  const c = getAddress(a);
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
};
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
/** Editorial dates are calendar days stored as UTC midnight. */
export const editionDate = (t: bigint) => dateFmt.format(new Date(Number(t) * 1000));
/** Moments (deliveries, closing times) in the reader's own time zone. */
/** Calendar date of a moment, in the reader's own time zone. */
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
export const day = (t: bigint) => dayFmt.format(new Date(Number(t) * 1000));
export const moment = (t: bigint) => timeFmt.format(new Date(Number(t) * 1000));
