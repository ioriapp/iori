import type { TeamHistory } from "@iori/protocol";
export type { TeamHistory } from "@iori/protocol";
type Translate = (text: string) => string;
export function historySummary(
  entry: Pick<TeamHistory, "summary" | "changes" | "restoredFrom">,
  t: Translate,
) {
  if (entry.restoredFrom !== undefined)
    return t("Restored version {version}").replace(
      "{version}",
      String(entry.restoredFrom),
    );
  if (!entry.changes) return t(entry.summary);
  const parts = entry.changes.map((change) => {
    const item = change.name
      ? t("{name}’s {item}")
          .replace(
            "{name}",
            change.name === "Parent" ? t("Parent") : change.name,
          )
          .replace("{item}", t(change.item))
      : t(change.item);
    return t(
      {
        added: "Added {item}",
        removed: "Removed {item}",
        changed: "Changed {item}",
      }[change.action],
    ).replace("{item}", item);
  });
  if (parts.length > 3)
    return [
      ...parts.slice(0, 3),
      t("{count} more changes").replace("{count}", String(parts.length - 3)),
    ].join(t(" · "));
  return parts.join(t(" · "));
}
