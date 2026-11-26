import { defaultRehypePlugins, type AllowElement } from "streamdown";
import type { PluggableList, Plugin } from "unified";

const driveAbsolute = /^[A-Za-z]:[\\/]/u;
const fileUri = /^file:\/\/\/(?!\/)/iu;
const networkPath = /^[/\\]{2}/u;

function decodeTarget(raw: string): string | undefined {
  try {
    const path = decodeURIComponent(raw.split(/[?#]/u, 1)[0]!);
    return path && !path.includes("\0") ? path : undefined;
  } catch {
    return undefined;
  }
}

export function parseStandaloneLocalAbsolutePath(
  raw: string,
): string | undefined {
  const decoded = decodeTarget(raw);
  if (!decoded) return undefined;
  if (driveAbsolute.test(decoded)) return decoded;
  if (!fileUri.test(raw)) return undefined;
  const path = decoded.slice("file://".length);
  if (networkPath.test(path)) return undefined;
  const drivePath = path.slice(1);
  if (/^[A-Za-z]:/u.test(drivePath))
    return driveAbsolute.test(drivePath) ? drivePath : undefined;
  return path;
}

export function resolveStandaloneTarget(raw: string): string | undefined {
  const absolute = parseStandaloneLocalAbsolutePath(raw);
  if (absolute !== undefined) return absolute;
  const path = decodeTarget(raw);
  if (
    !path ||
    /^[a-z][a-z\d+.-]*:/iu.test(path) ||
    networkPath.test(path) ||
    path.startsWith("\\")
  )
    return undefined;
  return path;
}

type Element = Parameters<AllowElement>[0];
type Root = Extract<Parameters<AllowElement>[2], { type: "root" }>;

export function rehypeStandaloneLocalPaths() {
  function visit(parent: Root | Element) {
    for (const node of parent.children) {
      if (node.type !== "element") continue;
      const props = node.properties;
      delete props.dataIoriLocalSrc;
      delete props.dataIoriLocalHref;
      if (node.tagName === "img" || node.tagName === "a") {
        const image = node.tagName === "img";
        const key = image ? "src" : "href";
        const raw = props[key];
        if (
          typeof raw === "string" &&
          parseStandaloneLocalAbsolutePath(raw) !== undefined
        ) {
          // Keep the original encoding until the component resolves the target.
          props[image ? "dataIoriLocalSrc" : "dataIoriLocalHref"] = raw;
          delete props[key];
        }
      }
      visit(node);
    }
  }
  return visit;
}

// Streamdown types its named defaults as generic unified plugins.
const [sanitize, schema] = defaultRehypePlugins.sanitize as [
  Plugin,
  { attributes: Record<string, unknown[]> },
];
const standaloneSanitizeSchema = {
  ...schema,
  attributes: {
    ...schema.attributes,
    img: [...schema.attributes.img!, "dataIoriLocalSrc"],
    a: [...schema.attributes.a!, "dataIoriLocalHref"],
  },
};

export const standaloneRehypePlugins: PluggableList = [
  rehypeStandaloneLocalPaths,
  [sanitize, standaloneSanitizeSchema],
];
