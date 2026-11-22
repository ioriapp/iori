import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { code as claude } from "./claude/definition.ts";
import { code as codex } from "./codex/definition.ts";
import { code as pi } from "./pi/definition.ts";
import { code as opencode } from "./opencode/definition.ts";
import { code as cursor } from "./cursor/definition.ts";
import { code as antigravity } from "./antigravity/definition.ts";
import { code as qoder } from "./qoder/definition.ts";
import { code as codebuddy } from "./codebuddy/definition.ts";
import { code as kiro } from "./kiro/definition.ts";
import { code as grok } from "./grok/definition.ts";
import { code as muse } from "./muse-code/definition.ts";
import { code as kimi } from "./kimi-code/definition.ts";
import { code as vibe } from "./vibe/definition.ts";
import {
  readDefinition,
  reasonText,
  type DefinitionFile,
} from "./definition-file.ts";
import { imageHash } from "./definition-images.ts";
import {
  cliDefinition,
  definitionInfo,
  type CliDefinition,
  type CliCode,
} from "./definition-builder.ts";

// Registration order is the order of the bundled CLI list.
const registrations: (CliCode | string)[] = [
  claude,
  codex,
  pi,
  opencode,
  cursor,
  antigravity,
  qoder,
  codebuddy,
  kiro,
  grok,
  vibe,
  kimi,
  "vtcode",
  "hermes",
  "amp",
  "omp",
  muse,
];
export const bundledCode = (id: string) =>
  registrations.find(
    (entry): entry is CliCode => typeof entry !== "string" && entry.id === id,
  );
export const bundled = registrations.map((entry) => {
  const code = typeof entry === "string" ? undefined : entry;
  const id = typeof entry === "string" ? entry : entry.id;
  const url = new URL(`./${id}/definition.json`, import.meta.url);
  const text = readFileSync(url, "utf8");
  const read = readDefinition(JSON.parse(text), id);
  if ("reason" in read)
    throw new Error(`Bundled CLI definition ${id}: ${reasonText(read.reason)}`);
  return cliDefinition(
    read.definition,
    text,
    code ? "official" : "bundled",
    fileURLToPath(new URL(`./${id}/`, import.meta.url)),
    code,
  );
});
export const bundledIconHashes = new Map(
  bundled.map((definition) => {
    const info = definitionInfo(definition)!;
    return [
      definition.id,
      definition.icon
        ? {
            light: imageHash(
              readFileSync(join(info.folder, definition.icon.light)),
            ),
            ...(definition.icon.dark
              ? {
                  dark: imageHash(
                    readFileSync(join(info.folder, definition.icon.dark)),
                  ),
                }
              : {}),
          }
        : undefined,
    ];
  }),
);
export function bundledDefinition(id: string) {
  return bundled.find((entry) => entry.id === id);
}
export const isBundledDefinition = (id: string) => !!bundledDefinition(id);
/** Whether this Host writes the hooks of `file` itself; an official CLI's
 * code writes its own hooks instead. */
export const writesDefinitionHooks = (file: DefinitionFile) =>
  !!file.hooks && !bundledCode(file.id)?.hooks;

/** Whether the CLI has a model list to read: its definition's `models` or
 * an official CLI's code. */
export function listsModels(definition: CliDefinition): boolean {
  const info = definitionInfo(definition);
  return (
    !info || !!info.file.models || !!bundledCode(info.file.id)?.modelCatalog
  );
}
