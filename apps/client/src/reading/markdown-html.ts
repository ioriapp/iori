export type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
  position?: unknown;
};

export type ForgeHtmlOptions = {
  theme?: "dark" | "light";
};

const disclosureTag = /<\/?(?:details|summary)\b[^>]*>/giu;
const hasDisclosureTag = /<\/?(?:details|summary)\b[^>]*>/iu;
const breakTag = /^<br\s*\/?>$/iu;
const mediaHtmlCandidate = /<(?:picture|img)\b/iu;
const htmlEntities: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

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

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:amp|quot|#39|apos|lt|gt);/giu,
    (entity) => htmlEntities[entity.toLowerCase()] ?? entity,
  );
}

function parseAttributes(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern =
    /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of tagBody.matchAll(attrPattern)) {
    const name = match[1]!.toLowerCase();
    const raw = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeEntities(raw);
  }
  return attrs;
}

function parseSrcsetUrl(srcset: string): string | undefined {
  const first = srcset.split(",")[0]?.trim();
  if (!first) return undefined;
  const url = first.split(/\s+/u)[0]?.trim();
  return url || undefined;
}

function parseImageWidth(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = /^\s*(\d{1,4})(?:px)?\s*$/iu.exec(raw);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function imageNodeFromTag(
  imgAttrs: Record<string, string>,
  overrideSrc: string | undefined,
  position: unknown,
): MarkdownNode | undefined {
  const url = (overrideSrc ?? imgAttrs.src ?? "").trim();
  if (!url) return undefined;
  const width = parseImageWidth(imgAttrs.width);
  return {
    type: "image",
    url,
    alt: imgAttrs.alt ?? "",
    ...(width !== undefined ? { data: { hProperties: { width } } } : {}),
    position,
  };
}

function parsePictureInner(
  inner: string,
  theme: "dark" | "light" | undefined,
  position: unknown,
): MarkdownNode | undefined {
  const sources: Array<Record<string, string>> = [];
  let imgAttrs: Record<string, string> | undefined;
  let remainder = inner;
  const tagPattern = /<(source|img)\b([\s\S]*?)\/?>/giu;
  for (const match of inner.matchAll(tagPattern)) {
    const tag = match[1]!.toLowerCase();
    const attrs = parseAttributes(match[2] ?? "");
    if (tag === "source") sources.push(attrs);
    else if (tag === "img" && !imgAttrs) imgAttrs = attrs;
    remainder = remainder.replace(match[0], "");
  }
  // Reject unexpected nested HTML inside <picture>.
  if (remainder.trim() !== "") return undefined;
  let chosenSrc: string | undefined;
  if (theme) {
    const scheme = new RegExp(`prefers-color-scheme\\s*:\\s*${theme}\\b`, "iu");
    const matched = sources.find(
      (source) => source.media && scheme.test(source.media) && source.srcset,
    );
    if (matched?.srcset) chosenSrc = parseSrcsetUrl(matched.srcset);
  }
  return imageNodeFromTag(imgAttrs ?? {}, chosenSrc, position);
}

/**
 * Converts HTML blocks/fragments containing only `<picture>`, `<img>`, and
 * optional `<p>` wrappers into standard MDAST `image` nodes so they pass
 * through the same local-image and path-boundary handling as `![alt](path)`.
 */
function parseMediaHtml(
  raw: string,
  theme: "dark" | "light" | undefined,
  position: unknown,
): MarkdownNode[] | undefined {
  const trimmed = raw.trim();
  if (!mediaHtmlCandidate.test(trimmed)) return undefined;
  // Unwrap an outer <p ...>...</p> if present.
  let body = trimmed;
  const pWrapped = /^<p(?:\s[^>]*)?>([\s\S]*)<\/p>$/iu.exec(body);
  if (pWrapped) body = pWrapped[1]!.trim();

  const images: MarkdownNode[] = [];
  const tokenPattern =
    /<picture(?:\s[^>]*)?>([\s\S]*?)<\/picture>|<img\b([\s\S]*?)\/?>|<br\s*\/?>/giu;
  let cursor = 0;
  for (const match of body.matchAll(tokenPattern)) {
    const gap = body.slice(cursor, match.index);
    if (gap.trim() !== "") return undefined;
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) {
      const node = parsePictureInner(match[1], theme, position);
      if (!node) return undefined;
      images.push(node);
    } else if (match[2] !== undefined) {
      const node = imageNodeFromTag(
        parseAttributes(match[2]),
        undefined,
        position,
      );
      if (!node) return undefined;
      images.push(node);
    }
  }
  if (body.slice(cursor).trim() !== "" || images.length === 0) return undefined;
  return images;
}

/**
 * Raw HTML is still shown as text, but as GitHub and Forgejo show it:
 * comments are hidden, `<details>`/`<summary>` show their text without
 * the tags, and `<picture>`/`<img>` become standard Markdown images routed
 * through the existing local-image boundary. Code keeps all of it.
 */
export function forgeHtml(options?: ForgeHtmlOptions) {
  const theme = options?.theme;
  const plain = (node: MarkdownNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MarkdownNode[] => {
      if (child.type !== "html") {
        plain(child);
        return [child];
      }
      const value = (child.value ?? "").replace(/<!--[\s\S]*?-->/gu, "");
      const trimmed = value.trim();
      if (!trimmed) return [];
      if (phrasing.has(node.type) && breakTag.test(trimmed)) {
        return [{ type: "break", position: child.position }];
      }
      const images = parseMediaHtml(trimmed, theme, child.position);
      if (images) {
        if (phrasing.has(node.type)) return images;
        const spaced: MarkdownNode[] = [];
        for (let index = 0; index < images.length; index += 1) {
          if (index > 0) spaced.push({ type: "text", value: " " });
          spaced.push(images[index]!);
        }
        return [
          {
            type: "paragraph",
            position: child.position,
            children: spaced,
          },
        ];
      }
      if (!hasDisclosureTag.test(value)) return [{ ...child, value }];
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
