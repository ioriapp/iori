export type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: unknown;
};

const disclosureTag = /<\/?(?:details|summary)\b[^>]*>/giu;
const hasDisclosureTag = /<\/?(?:details|summary)\b[^>]*>/iu;
// Parents whose children are text and inline marks, not paragraphs.
const phrasing = new Set([
  "paragraph",
  "heading",
  "emphasis",
  "strong",
  "delete",
  "link",
  "linkReference",
  "tableCell",
]);

/**
 * Raw HTML is still shown as text, but as GitHub and Forgejo show it:
 * comments are hidden, and `<details>`/`<summary>` show their text without
 * the tags, the summary as an ordinary paragraph. Code keeps all of it.
 */
export function forgeHtml() {
  const plain = (node: MarkdownNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MarkdownNode[] => {
      if (child.type !== "html") {
        plain(child);
        return [child];
      }
      const value = (child.value ?? "").replace(/<!--[\s\S]*?-->/gu, "");
      if (!hasDisclosureTag.test(value))
        return value.trim() ? [{ ...child, value }] : [];
      const texts = value
        .split(disclosureTag)
        .map((text) => text.trim())
        .filter(Boolean);
      if (phrasing.has(node.type))
        return texts.length
          ? [{ type: "text", value: texts.join(" "), position: child.position }]
          : [];
      return texts.map((text) => ({
        type: "paragraph",
        position: child.position,
        children: [{ type: "text", value: text }],
      }));
    });
  };
  return plain;
}
