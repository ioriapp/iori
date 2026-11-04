import { useEffect, useState } from "react";
import type { ForgeIssueRepository } from "@iori/protocol";
import { connection } from "../connection.ts";

export const issueRepositoryKey = (host: string, workspacePath: string) =>
  JSON.stringify([host, workspacePath]);

/**
 * The Forge repository of each repository in the sidebar, so that its row
 * offers Issues only when the Forge is known. Read once per repository and
 * again when the Host's Forge settings or detection change; a failed read
 * keeps what was known.
 */
export function useIssueRepositories(
  repositories: { host: string; workspacePath: string }[],
  connectedHosts: string[],
) {
  const [known, setKnown] = useState<
    Record<string, ForgeIssueRepository | null>
  >({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  useEffect(() => {
    const stop = connection.subscribeHostEvents((host, event) => {
      if (event.type === "forge.settings.changed")
        setRevisions((current) => ({
          ...current,
          [host]: (current[host] ?? 0) + 1,
        }));
    });
    return () => {
      stop();
    };
  }, []);
  const wanted = JSON.stringify(
    repositories
      .filter((item) => connectedHosts.includes(item.host))
      .map((item) => [
        item.host,
        item.workspacePath,
        revisions[item.host] ?? 0,
      ]),
  );
  useEffect(() => {
    let active = true;
    for (const [host, path] of JSON.parse(wanted) as [string, string][])
      void connection
        .requestHost(host, "forge.issues.repository", { path })
        .then((result) => {
          if (!active || !result?.ok) return;
          setKnown((current) => ({
            ...current,
            [issueRepositoryKey(host, path)]: result.result.repository ?? null,
          }));
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [wanted]);
  return known;
}
