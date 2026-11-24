import { defaultRemarkPlugins } from "streamdown";
import { forgeHtml, type ForgeHtmlOptions } from "./markdown-html.ts";

/** The Markdown parsing shared by Files and Issues. */
export const markdownRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  forgeHtml,
];

/** Remark plugins configured with the active theme for `<picture>` sources. */
export function markdownRemarkPluginsForTheme(
  theme: ForgeHtmlOptions["theme"],
) {
  return [
    ...Object.values(defaultRemarkPlugins),
    [forgeHtml, { theme }] as [typeof forgeHtml, ForgeHtmlOptions],
  ];
}
