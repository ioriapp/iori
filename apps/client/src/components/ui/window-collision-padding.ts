import type { ComponentProps } from "react";
import type { Popover } from "radix-ui";
import { hasWindowChrome } from "../../native";

type CollisionPadding = ComponentProps<typeof Popover.Content>["collisionPadding"];

// Keep floating content below the native caption, using the same CSS token as
// the drag strip. Other edges retain the component or caller's padding.
export function windowCollisionPadding(
  padding: CollisionPadding = 0,
): CollisionPadding {
  if (!hasWindowChrome) return padding;
  const captionHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--window-caption-height",
    ),
  );
  const edges =
    typeof padding === "number"
      ? { top: padding, right: padding, bottom: padding, left: padding }
      : padding;
  return { ...edges, top: Math.max(edges.top ?? 0, captionHeight) };
}
