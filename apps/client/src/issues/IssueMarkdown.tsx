import { useMemo, type ReactNode } from "react";
import { Streamdown, defaultRehypePlugins, type Components } from "streamdown";
import { native } from "../native.ts";
import { markdownRemarkPlugins } from "../reading/markdown-plugins.ts";

/** A link of an Issue: relative to the Issue's page on the Forge. */
function linkTarget(href: string | undefined, base: string) {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An Issue's body or comment, drawn as Files draws Markdown: raw HTML is shown
 * as text and links open only on an explicit click. Images are not fetched;
 * each is a link with its description that opens in the browser.
 */
export function IssueMarkdown({
  text,
  base,
  locale,
}: {
  text: string;
  /** The Issue's page, which relative links and images start from. */
  base: string;
  locale: string;
}) {
  const ja = locale.startsWith("ja");
  const rendered = useMemo(() => {
    const link = (href: string | undefined, children: ReactNode) => {
      const target = linkTarget(href, base);
      const open = () => {
        if (target) void native.openUrl(target);
      };
      return (
        // No href: middle-click and Ctrl+click cannot open a new WebView window.
        <a
          role="link"
          tabIndex={0}
          data-iori-href={target}
          onClick={(event) => {
            event.preventDefault();
            open();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") open();
          }}
        >
          {children}
        </a>
      );
    };
    const components = {
      a: ({ href, children }: { href?: string; children?: ReactNode }) =>
        link(href, children),
      // Code is one plain surface, as in Files.
      pre: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
      code: ({
        className,
        children,
      }: {
        className?: string;
        children?: ReactNode;
      }) => <code className={className}>{children}</code>,
      img: ({ src, alt }: { src?: string | Blob; alt?: string }) =>
        typeof src === "string" ? (
          link(
            src,
            <span data-iori-part="issue-image">
              {ja ? "画像" : "Image"}
              {alt ? `: ${alt}` : ""}
            </span>,
          )
        ) : (
          <span className="reading-inline-note">{alt}</span>
        ),
    } as Components;
    return (
      <Streamdown
        mode="static"
        controls={false}
        parseIncompleteMarkdown={false}
        linkSafety={{ enabled: false }}
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={[defaultRehypePlugins.sanitize!]}
        components={components}
      >
        {text}
      </Streamdown>
    );
  }, [text, base, ja]);
  return (
    <div
      className="reading-markdown issues-markdown"
      data-iori-part="issue-markdown"
    >
      {rendered}
    </div>
  );
}
