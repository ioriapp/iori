import { defaultRemarkPlugins } from "streamdown";
import { forgeHtml } from "./markdown-html.ts";

/** The Markdown parsing shared by Files and Issues. */
export const markdownRemarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  forgeHtml,
];
