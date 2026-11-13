// Canonical ABI hash: keccak256 of the ABI serialised as JSON with object keys sorted and no whitespace.
import { keccak_256 } from "@noble/hashes/sha3.js";
const sortKeys = (v) =>
  Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
  : v;
export const canonicalJson = (abi) => JSON.stringify(sortKeys(abi));
export const canonicalKeccak = (abi) => Buffer.from(keccak_256(new TextEncoder().encode(canonicalJson(abi)))).toString("hex");
