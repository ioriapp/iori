export function pasteData(text: string, bracketed: boolean) {
  const normalized = text.replace(/\r?\n/g, "\r");
  return bracketed && normalized
    ? `\x1b[200~${normalized.replace(/\x1b/g, "\u241b")}\x1b[201~`
    : normalized;
}

export function pasteImagePaths(paths: string[], bracketed: boolean) {
  return paths.map((path) => pasteData(path, bracketed)).join("");
}
