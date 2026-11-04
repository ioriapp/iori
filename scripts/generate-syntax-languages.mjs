import { readFile, writeFile, readdir } from "node:fs/promises";
import ts from "typescript";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import {
  VSCODE_VERSION,
  LINGUIST_COMMIT,
  sourcesDirectory,
} from "./fetch-syntax-languages.mjs";
const hostRequire = createRequire(
  new URL("../apps/host/package.json", import.meta.url),
);
const YAML = hostRequire("yaml");
const shikiVersion = hostRequire("shiki/package.json").version;
const { bundledLanguagesInfo, bundledLanguages } = await import(
  hostRequire.resolve("shiki/langs")
);
const here = sourcesDirectory + "/";
const resolveLang = new Map();
for (const lang of bundledLanguagesInfo)
  for (const alias of [lang.id, lang.name, ...(lang.aliases ?? [])])
    resolveLang.set(alias.toLowerCase(), lang.id);
const aliases = {
  fortran: "fortran-fixed-form",
  "fortran free form": "fortran-free-form",
  javascriptreact: "jsx",
  typescriptreact: "tsx",
  shellscript: "shellscript",
  bat: "bat",
  objectivec: "objective-c",
  shaderlab: "shaderlab",
  jade: "pug",
  dockerfile: "docker",
  gitignore: "git-ignore",
  properties: "properties",
  ignore: "git-ignore",
};
function shiki(name, extra = []) {
  for (const n of [aliases[name.toLowerCase()], name, ...extra].filter(
    Boolean,
  )) {
    const id = resolveLang.get(n.toLowerCase());
    if (id) return id;
  }
}
const canonicalLanguages = new Map();
const scopeByLanguage = new Map();
const normalizedName = (value) => value.toLowerCase().replace(/[\s()_-]/gu, "");
for (const lang of bundledLanguagesInfo)
  for (const name of [lang.id, lang.name])
    canonicalLanguages.set(normalizedName(name), lang.id);
const linguisticNames = {
  "1C Enterprise": "bsl",
  DM: "dream-maker",
  "Godot Resource": "gdresource",
  Fortran: "fortran-fixed-form",
  "Windows Registry Entries": "reg",
  "Terraform Template": "terraform",
};
for (const lang of bundledLanguagesInfo) {
  const data = await bundledLanguages[lang.id]();
  const grammar = data.default.find((x) => x.name === lang.id);
  if (grammar?.scopeName) {
    scopeByLanguage.set(lang.id, grammar.scopeName);
  }
}
const vscode = [];
for (const file of (await readdir(here + "vscode")).sort()) {
  const value = ts.parseConfigFileTextToJson(
    file,
    await readFile(here + "vscode/" + file, "utf8"),
  ).config;
  for (const lang of value?.contributes?.languages ?? []) {
    const id = shiki(lang.id, lang.aliases ?? []);
    if (!id) continue;
    vscode.push({
      language: id,
      ...Object.fromEntries(
        ["extensions", "filenames", "filenamePatterns", "firstLine"]
          .filter((k) => lang[k])
          .map((k) => [k, lang[k]]),
      ),
    });
  }
}
const linguist = YAML.parse(await readFile(here + "languages.yml", "utf8"));
const owners = {
  extensions: new Map(),
  filenames: new Map(),
  interpreters: new Map(),
};
for (const [name, lang] of Object.entries(linguist))
  for (const k of Object.keys(owners))
    for (const value of lang[k] ?? []) {
      const key = value.toLowerCase();
      if (!owners[k].has(key)) owners[k].set(key, new Set());
      owners[k].get(key).add(name);
    }
const extras = [];
const matched = new Set(vscode.map((x) => x.language));
for (const [name, lang] of Object.entries(linguist)) {
  const byName =
    linguisticNames[name] ??
    canonicalLanguages.get(normalizedName(name)) ??
    (lang.aliases ?? [])
      .map((alias) => canonicalLanguages.get(normalizedName(alias)))
      .find(Boolean);
  const byAlias = shiki(name, lang.aliases ?? []);
  const id =
    byName ??
    (byAlias && scopeByLanguage.get(byAlias) === lang.tm_scope
      ? byAlias
      : undefined);
  if (!id) continue;
  if (vscode.some((rule) => rule.language === id)) continue;
  const fields = {};
  for (const k of Object.keys(owners)) {
    const values = (lang[k] ?? []).filter(
      (v) => owners[k].get(v.toLowerCase()).size === 1,
    );
    if (values.length) fields[k] = values;
  }
  // Linguist supplies associations only for languages absent from the VS Code table.
  if (Object.keys(fields).length) extras.push({ language: id, ...fields });
  matched.add(id);
}
const sha = LINGUIST_COMMIT;
for (const rule of [...vscode, ...extras]) {
  if (!(rule.language in bundledLanguages))
    throw new Error(`Shiki has no grammar: ${rule.language}`);
}
const header = `/**\n * Generated language associations. Sources (MIT):\n * VS Code ${VSCODE_VERSION}, extensions/<name>/package.json contributes.languages:\n * https://github.com/microsoft/vscode/tree/${VSCODE_VERSION}/extensions\n * GitHub Linguist ${sha}, extensions/filenames/interpreters:\n * https://github.com/github-linguist/linguist/blob/${sha}/lib/linguist/languages.yml\n *\n * Rebuild: node scripts/fetch-syntax-languages.mjs && node scripts/generate-syntax-languages.mjs\n *\n * Generation: parse VS Code manifests (JSONC), preserve extensions, filenames,\n * filenamePatterns and firstLine; resolve ids/aliases against Shiki ${shikiVersion}\n * bundledLanguagesInfo (JSX/TSX, Objective-C, Dockerfile, Jade, Fortran aliases resolved).\n * Parse Linguist YAML; retain each association only if exactly one Linguist\n * language owns it (including languages unavailable in Shiki when counting).\n * Match Linguist names/aliases to canonical Shiki names (ignoring spaces,\n * brackets and hyphens); alias-to-alias matches also require matching tm_scope.\n * Never substitute a different language\n * merely because Linguist reuses its grammar (e.g. Dhall/Haskell, Nu/Nushell).\n * Name bindings: 1C Enterprise=bsl, DM=dream-maker, Godot Resource=gdresource,\n * Fortran=fortran-fixed-form, Windows Registry Entries=reg, Terraform Template=terraform.\n * Linguist supplies only languages absent from VS Code; never run heuristics.\n * All bundled Shiki grammars remain available for embedded languages.\n */\n`;
const output =
  header +
  `export type SyntaxLanguageAssociation = {\n  language: string;\n  extensions?: string[];\n  filenames?: string[];\n  filenamePatterns?: string[];\n  firstLine?: string;\n  interpreters?: string[];\n};\n\nexport const vscodeLanguages: SyntaxLanguageAssociation[] = ${JSON.stringify(vscode, null, 2)};\n\nexport const linguistLanguages: SyntaxLanguageAssociation[] = ${JSON.stringify(extras, null, 2)};\n`;
await writeFile(
  fileURLToPath(
    new URL("../apps/host/src/files-syntax-languages.ts", import.meta.url),
  ),
  await format(output, { parser: "typescript" }),
);
console.log({
  vscode: vscode.length,
  linguist: extras.length,
  languages: matched.size,
  unassociated: bundledLanguagesInfo
    .map((x) => x.id)
    .filter((x) => !matched.has(x)),
});
