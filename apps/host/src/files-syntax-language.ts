import { basename, matchesGlob } from "node:path";
import {
  vscodeLanguages,
  linguistLanguages,
  type SyntaxLanguageAssociation,
} from "./files-syntax-languages.ts";

const firstLines = new Map(
  vscodeLanguages
    .filter((rule) => rule.firstLine)
    .map((rule) => [rule, new RegExp(rule.firstLine!)]),
);

function association(
  rules: SyntaxLanguageAssociation[],
  path: string,
  firstLine: string,
): string | undefined {
  const name = basename(path).toLowerCase();
  // Exact names and patterns override extensions, as in VS Code's association registry.
  let exact: string | undefined;
  let pattern: string | undefined;
  let extension: string | undefined;
  let extensionLength = 0;
  let patternLength = 0;
  for (const rule of rules) {
    if (rule.filenames?.some((value) => value.toLowerCase() === name))
      exact = rule.language;
    for (const glob of rule.filenamePatterns ?? []) {
      const target = glob.includes("/") ? path.toLowerCase() : name;
      if (
        glob.length >= patternLength &&
        matchesGlob(target, glob.toLowerCase())
      ) {
        pattern = rule.language;
        patternLength = glob.length;
      }
    }
    for (const ext of rule.extensions ?? []) {
      if (ext.length >= extensionLength && name.endsWith(ext.toLowerCase())) {
        extension = rule.language;
        extensionLength = ext.length;
      }
    }
  }
  if (exact ?? pattern ?? extension) return exact ?? pattern ?? extension;
  for (const rule of rules)
    if (firstLines.get(rule)?.test(firstLine)) return rule.language;
  // Linguist supplies interpreter command names, never an inspection of body text.
  if (firstLine.startsWith("#!")) {
    const commands = firstLine.slice(2).trim().split(/\s+/u);
    const executable = commands.shift()?.split("/").at(-1);
    const command =
      executable === "env"
        ? commands.find((word) => !word.startsWith("-") && !word.includes("="))
        : executable;
    for (const rule of rules)
      if (command && rule.interpreters?.includes(command)) return rule.language;
  }
  return undefined;
}

export function syntaxLanguage(
  path: string,
  firstLine: string,
): string | undefined {
  return (
    association(vscodeLanguages, path, firstLine) ??
    association(linguistLanguages, path, firstLine)
  );
}
