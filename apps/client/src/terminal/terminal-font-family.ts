export const DEFAULT_TERMINAL_FONT_FAMILY =
  '"JetBrains Mono Variable", "BIZ UDGothic", "Noto Sans Mono CJK JP", "Noto Sans CJK JP", "Noto Sans JP Variable", "Symbols Nerd Font Mono", monospace';

/** Font names are CSS strings, never CSS syntax supplied by the user. */
export function terminalFontFamily(value: string): string {
  const names = value
    .split(",")
    .map((name) => name.trim())
    // A name copied from CSS or VS Code keeps its own quotes ('Fira Code').
    .map((name) =>
      /^(['"]).+\1$/su.test(name) ? name.slice(1, -1).trim() : name,
    )
    .filter(Boolean);
  const quoted = names.map(
    (name) =>
      '"' +
      name
        .replace(/[\\"]/g, "\\$&")
        .replace(
          /[\u0000-\u001f\u007f]/g,
          (character) => `\\${character.charCodeAt(0).toString(16)} `,
        ) +
      '"',
  );
  return [...quoted, DEFAULT_TERMINAL_FONT_FAMILY].join(", ");
}
