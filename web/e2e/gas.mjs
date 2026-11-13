// The page's deliver gas rule, evaluated from web/src/config.ts so the test cannot drift from the page.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/config.ts"), "utf8");
const num = (name) => BigInt(src.match(new RegExp(`export const ${name} = ([0-9_]+)n;`))[1].replaceAll("_", ""));
export const deliverGasOf = (n) => num("DELIVER_GAS_BASE") + num("DELIVER_GAS_PER_ADDRESS") * BigInt(n);
