import { readFile } from "node:fs/promises";
import { limitedContracts } from "./limited.mjs";
const cli = process.env.IORI_CLI_COMPAT_CLI;
const definition = JSON.parse(
  await readFile(
    new URL(`../../apps/host/src/cli/${cli}/definition.json`, import.meta.url),
    "utf8",
  ),
);
limitedContracts(
  cli,
  new RegExp(
    `${definition.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}|Log in|Login|Sign in|Authenticate`,
    "iu",
  ),
);
