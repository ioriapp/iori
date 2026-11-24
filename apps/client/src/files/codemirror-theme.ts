import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Syntax highlighting mapped directly to iori's CSS custom properties
 * (`--syntax-*` in index.css), so light/dark theme switching applies automatically.
 */
export const ioriHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--syntax-comment)",
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.modifier,
    ],
    color: "var(--syntax-keyword)",
  },
  {
    tag: [
      tags.string,
      tags.special(tags.string),
      tags.docString,
      tags.character,
    ],
    color: "var(--syntax-string)",
  },
  {
    tag: [tags.number, tags.integer, tags.float],
    color: "var(--syntax-number)",
  },
  {
    tag: [
      tags.bool,
      tags.null,
      tags.atom,
      tags.constant(tags.variableName),
      tags.standard(tags.variableName),
    ],
    color: "var(--syntax-constant)",
  },
  {
    tag: [
      tags.typeName,
      tags.className,
      tags.namespace,
      tags.macroName,
      tags.definition(tags.typeName),
    ],
    color: "var(--syntax-type)",
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.definition(tags.function(tags.variableName)),
      tags.labelName,
    ],
    color: "var(--syntax-function)",
  },
  {
    tag: [tags.variableName, tags.local(tags.variableName), tags.self],
    color: "var(--syntax-variable)",
  },
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: "var(--syntax-property)",
  },
  {
    tag: tags.tagName,
    color: "var(--syntax-tag)",
  },
  {
    tag: tags.attributeName,
    color: "var(--syntax-attribute)",
  },
  {
    tag: [
      tags.operator,
      tags.punctuation,
      tags.bracket,
      tags.angleBracket,
      tags.squareBracket,
      tags.paren,
      tags.brace,
    ],
    color: "var(--syntax-operator)",
  },
  {
    tag: tags.regexp,
    color: "var(--syntax-regexp)",
  },
  {
    tag: tags.escape,
    color: "var(--syntax-escape)",
  },
  {
    tag: [
      tags.heading,
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    color: "var(--syntax-heading)",
    fontWeight: "700",
  },
  {
    tag: tags.emphasis,
    color: "var(--syntax-emphasis)",
    fontStyle: "italic",
  },
  {
    tag: tags.strong,
    color: "var(--syntax-strong)",
    fontWeight: "700",
  },
  {
    tag: [tags.link, tags.url],
    color: "var(--syntax-link)",
    textDecoration: "underline",
  },
  {
    tag: tags.inserted,
    color: "var(--syntax-inserted)",
  },
  {
    tag: tags.deleted,
    color: "var(--syntax-deleted)",
  },
  {
    tag: tags.strikethrough,
    textDecoration: "line-through",
  },
]);

/**
 * CodeMirror 6 theme bound to iori's semantic CSS tokens, including the
 * search/replace panel so both light and dark modes stay consistent.
 */
export const ioriEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    lineHeight: "1.375rem",
    outline: "none",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.375rem",
  },
  ".cm-content": {
    padding: "0.25rem 0",
    caretColor: "var(--primary)",
  },
  ".cm-line": {
    padding: "0 1rem 0 0.5rem",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--primary)",
    borderLeftWidth: "1.5px",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in oklch, var(--primary) 24%, transparent)",
    },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklch, var(--accent) 45%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border-subtle)",
    userSelect: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--accent) 45%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 0.75rem 0 0.5rem",
    minWidth: "2.75rem",
    cursor: "pointer",
    fontVariantNumeric: "tabular-nums",
    fontSize: "var(--text-xs)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklch, var(--accent) 70%, transparent)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent)",
    outline: "1px solid color-mix(in oklch, var(--primary) 45%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor:
      "color-mix(in oklch, var(--status-waiting) 35%, transparent)",
    borderRadius: "var(--radius-xs)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor:
      "color-mix(in oklch, var(--status-waiting) 75%, transparent)",
    outline: "1px solid var(--status-waiting)",
  },
  ".cm-panels": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    borderColor: "var(--border)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-xs)",
    zIndex: "var(--z-sticky)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },
  ".cm-panel.cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.375rem",
    padding: "0.375rem 2.25rem 0.375rem 0.75rem",
  },
  ".cm-panel.cm-search br": {
    flexBasis: "100%",
    height: "0",
  },
  ".cm-panel.cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontSize: "var(--text-xs)",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    margin: "0 0.25rem 0 0",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    accentColor: "var(--primary)",
    margin: "0",
  },
  ".cm-textfield": {
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    border: "1px solid var(--input)",
    borderRadius: "var(--radius-sm)",
    padding: "0.25rem 0.5rem",
    fontSize: "var(--text-xs)",
    lineHeight: "1.375rem",
    outline: "none",
    verticalAlign: "middle",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--ring)",
    boxShadow: "0 0 0 2px color-mix(in oklch, var(--ring) 35%, transparent)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--secondary)",
    color: "var(--secondary-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "0.25rem 0.5rem",
    fontSize: "var(--text-xs)",
    lineHeight: "1.25rem",
    cursor: "pointer",
    verticalAlign: "middle",
  },
  ".cm-button:hover": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-button:active": {
    backgroundColor: "var(--accent)",
  },
  ".cm-button:focus-visible": {
    outline: "2px solid var(--ring)",
    outlineOffset: "1px",
  },
  ".cm-panel.cm-search [name=close]": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    fontSize: "1rem",
    lineHeight: "1",
    padding: "0.25rem 0.375rem",
    borderRadius: "var(--radius-sm)",
    top: "0.375rem",
    right: "0.375rem",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    backgroundColor: "var(--accent)",
    color: "var(--foreground)",
  },
  "@media (pointer: coarse)": {
    ".cm-textfield": {
      minHeight: "2.5rem",
    },
    ".cm-button": {
      minHeight: "2.5rem",
      padding: "0.375rem 0.75rem",
    },
    ".cm-panel.cm-search [name=close]": {
      minWidth: "2.5rem",
      minHeight: "2.5rem",
    },
  },
});

export const ioriEditorExtensions: Extension[] = [
  ioriEditorTheme,
  syntaxHighlighting(ioriHighlightStyle),
];

const japaneseSearchPhrases: Record<string, string> = {
  Find: "検索",
  Replace: "置換",
  next: "次へ",
  previous: "前へ",
  all: "すべて",
  "match case": "大文字と小文字を区別",
  regexp: "正規表現",
  "by word": "単語単位",
  replace: "置換",
  "replace all": "すべて置換",
  close: "閉じる",
  "current match": "現在の一致",
  "on line": "行",
  "Go to line": "行へ移動",
  go: "移動",
};

export function editorPhrasesExtension(locale: string): Extension {
  if (locale.toLowerCase().startsWith("ja"))
    return EditorState.phrases.of(japaneseSearchPhrases);
  return [];
}
