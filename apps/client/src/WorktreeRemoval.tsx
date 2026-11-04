import { useEffect, useState } from "react";
import type {
  HostInfo,
  WorktreeRemovalItem,
  WorktreeRemovalPreview,
  WorktreeRemovalResult,
  WorktreeRemovalWorking,
} from "@iori/protocol";
import { TriangleAlert } from "lucide-react";
import { connection } from "./connection.ts";
import { Button } from "./components/ui/button.tsx";
import { Checkbox } from "./components/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog.tsx";
import { ScrollArea } from "./components/ui/scroll-area.tsx";
import { FieldRow, SettingsSection } from "./components/page-layout.tsx";
import { worktreeLabel } from "./workspace-panel.tsx";
import { MiddleEllipsis } from "./MiddleEllipsis.tsx";
import "./worktree-creator.css";

const workStates: Record<WorktreeRemovalWorking["state"], string> = {
  running: "Running",
  approval: "Approval",
  question: "Question",
};

function countText(t: (key: string) => string, key: string, count: number) {
  return t(key).replace("{count}", String(count));
}

/** The worktree and the child worktrees that go with it, each child in the order it was delegated. */
function removalTree(items: WorktreeRemovalItem[]): WorktreeRemovalItem[] {
  return items.flatMap((item) => [item, ...removalTree(item.worktrees)]);
}

function Name({
  children,
  middle = false,
  ...rest
}: {
  children: string;
  middle?: boolean;
  "data-iori-removal-name"?: string;
}) {
  return (
    <span className="worktree-removal-name" title={children} {...rest}>
      {middle ? (
        <MiddleEllipsis
          text={children}
          className="worktree-removal-fitted-name"
        />
      ) : (
        children
      )}
    </span>
  );
}

function heading(title: string, warning = false) {
  return (
    <span
      className={
        warning
          ? "worktree-removal-warning-heading"
          : "worktree-removal-heading"
      }
    >
      {warning && <TriangleAlert aria-hidden="true" />}
      {title}
    </span>
  );
}

type Props = {
  host: HostInfo;
  path: string;
  cleanup: boolean;
  /** The sidebar's name for the worktree, known before the preview arrives. */
  label?: string;
  t: (key: string) => string;
  onClose: () => void;
  onRemoved: (paths: string[]) => void;
};
export function WorktreeRemoval({
  host,
  path,
  cleanup,
  label,
  t,
  onClose,
  onRemoved,
}: Props) {
  const [preview, setPreview] = useState<WorktreeRemovalPreview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [outcomes, setOutcomes] = useState<WorktreeRemovalResult["outcomes"]>(
    [],
  );
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void connection
      .requestHost(
        host.publicKey,
        cleanup ? "worktrees.cleanup" : "worktrees.preview",
        { path },
      )
      .then((response) => {
        if (!current) return;
        if (!response?.ok) {
          setError("Could not load worktrees. Check Git and retry.");
          return;
        }
        setPreview(response.result);
        setSelected(response.result.items.map((item) => item.path));
        setBranches([]);
        setError("");
      })
      .catch(() => {
        if (current) setError("Could not load worktrees. Check Git and retry.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [host.publicKey, path, cleanup, reload]);
  const accept = (result: WorktreeRemovalResult) => {
    setOutcomes(result.outcomes);
    onRemoved(
      result.outcomes.filter((item) => item.removed).map((item) => item.path),
    );
    if (result.outcomes.every((item) => item.removed && !item.error)) onClose();
    else
      setError(
        "Some worktrees could not be deleted. Review the result and retry.",
      );
  };
  const remove = async () => {
    if (!preview) return;
    const id = crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const response = await connection.requestHost(
        host.publicKey,
        "worktrees.remove",
        { previewId: preview.id, paths: selected, branches },
        id,
      );
      if (response?.ok) accept(response.result);
      else if (response) {
        setError("Could not delete the worktree.");
      } else
        setError(
          "Connection lost. Check the sidebar and delete the worktree again if it remains.",
        );
    } catch {
      setError(
        "Connection lost. Check the sidebar and delete the worktree again if it remains.",
      );
    } finally {
      setBusy(false);
    }
  };
  const tree = removalTree(preview?.items ?? []);
  const name = (item: WorktreeRemovalItem) =>
    worktreeLabel(item.branch, item.path, path);
  const changed = tree.filter((item) => item.changes.files > 0);
  const detached = tree.filter((item) => (item.detachedCommits ?? 0) > 0);
  const lost = tree.filter(
    (item) => item.branch && !item.deleteBranch && (item.commits ?? 0) > 0,
  );
  const target = lost.find((item) => item.target)?.target;
  const working = preview?.working ?? [];
  const root = preview?.items[0];
  const count =
    preview?.items.filter((item) => selected.includes(item.path)).length ?? 0;
  // With nothing to decide, the confirmation keeps only the line that names the
  // worktree: no empty body.
  const body =
    loading ||
    Boolean(error) ||
    outcomes.length > 0 ||
    Boolean(preview?.fetchFailed) ||
    (preview?.items.length ?? 0) === 0 ||
    (cleanup
      ? (preview?.items.length ?? 0) > 0
      : changed.length > 0 ||
        detached.length > 0 ||
        working.length > 0 ||
        lost.length > 0);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="folder-dialog worktree-create-dialog"
        data-iori-view="worktree-removal"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {t(cleanup ? "Delete merged worktrees" : "Delete worktree")}
          </DialogTitle>
          {cleanup ? (
            !loading &&
            (preview?.items.length ?? 0) > 0 && (
              <DialogDescription className="worktree-removal-summary">
                {countText(t, "{count} worktrees will be deleted.", count)}
              </DialogDescription>
            )
          ) : (
            <DialogDescription className="worktree-removal-summary">
              {t("{name} will be deleted.").replace(
                "{name}",
                label ??
                  (root ? name(root) : worktreeLabel(undefined, path, path)),
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        {body && (
          // The app's own scroll area keeps a visible scrollbar, as on the
          // sidebar, while the title and the buttons stay in place.
          <div data-slot="dialog-body" className="worktree-removal-body">
            <ScrollArea type="always" className="worktree-removal-scroll">
              {preview?.fetchFailed && (
                <p role="status" data-iori-fetch-warning="true">
                  {t(
                    "Fetch failed. Merged worktrees are checked against local references, which may be out of date.",
                  )}
                </p>
              )}
              {loading ? (
                <p>
                  {t(cleanup ? "Fetching and checking worktrees…" : "Loading…")}
                </p>
              ) : preview?.items.length === 0 ? (
                <p>{t("No merged worktrees to delete.")}</p>
              ) : cleanup ? (
                <div className="section-body">
                  <div className="section-rows">
                    {preview?.items.map((item) => (
                      <label
                        key={item.path}
                        className="field-row worktree-removal-select"
                        data-iori-removal-candidate={item.path}
                      >
                        <Checkbox
                          checked={selected.includes(item.path)}
                          disabled={busy}
                          data-iori-removal-select={item.path}
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked
                                ? [...current, item.path]
                                : current.filter((path) => path !== item.path),
                            )
                          }
                        />
                        <Name middle data-iori-removal-name={item.path}>
                          {name(item)}
                        </Name>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {changed.length > 0 && (
                    <SettingsSection
                      data-iori-removal-changes={changed
                        .map((item) => item.path)
                        .join(",")}
                      title={heading(
                        t("Uncommitted changes will be lost"),
                        true,
                      )}
                    >
                      <div className="section-rows">
                        {changed.map((item) => (
                          <FieldRow
                            key={item.path}
                            label={<Name middle>{name(item)}</Name>}
                            data-iori-removal-changed={item.path}
                          >
                            <span data-iori-removal-files={item.changes.files}>
                              {countText(
                                t,
                                item.changes.files === 1
                                  ? "1 file"
                                  : "{count} files",
                                item.changes.files,
                              )}
                            </span>
                          </FieldRow>
                        ))}
                      </div>
                    </SettingsSection>
                  )}
                  {detached.length > 0 && (
                    <SettingsSection
                      data-iori-removal-detached={detached
                        .map((item) => item.path)
                        .join(",")}
                      title={heading(
                        t("Commits not on any branch will be lost"),
                        true,
                      )}
                    >
                      <div className="section-rows">
                        {detached.map((item) => (
                          <FieldRow
                            key={item.path}
                            label={<Name middle>{name(item)}</Name>}
                          >
                            <span>
                              {countText(
                                t,
                                item.detachedCommits === 1
                                  ? "1 commit"
                                  : "{count} commits",
                                item.detachedCommits!,
                              )}
                            </span>
                          </FieldRow>
                        ))}
                      </div>
                    </SettingsSection>
                  )}
                  {lost.length > 0 && (
                    <SettingsSection
                      data-iori-removal-branches={lost
                        .map((item) => item.branch!)
                        .join(",")}
                      title={heading(
                        t("Branches with commits not in {target}").replace(
                          "{target}",
                          target ?? "",
                        ),
                      )}
                    >
                      <div className="section-rows">
                        {lost.map((item) => {
                          const branch = item.branch!;
                          const checked = branches.includes(branch);
                          const commits = item.commits ?? 0;
                          return (
                            <div
                              key={item.path}
                              className="field-row worktree-removal-branch"
                              data-iori-removal-branch={branch}
                            >
                              <div className="field-copy">
                                <Name middle>{branch}</Name>
                                {/* Marking the branch replaces the count with
                                  what disappears, in the body's own color. */}
                                <p
                                  className={
                                    checked
                                      ? "page-description worktree-removal-loss"
                                      : "page-description"
                                  }
                                  data-iori-removal-branch-loss={
                                    checked ? "true" : undefined
                                  }
                                >
                                  {countText(
                                    t,
                                    checked
                                      ? commits === 1
                                        ? "1 commit will be lost."
                                        : "{count} commits will be lost."
                                      : commits === 1
                                        ? "1 commit"
                                        : "{count} commits",
                                    commits,
                                  )}
                                </p>
                              </div>
                              <label className="field-control worktree-removal-branch-toggle">
                                <Checkbox
                                  checked={checked}
                                  disabled={busy}
                                  data-iori-removal-branch-select={branch}
                                  onCheckedChange={(value) =>
                                    setBranches((current) =>
                                      value
                                        ? [...current, branch]
                                        : current.filter(
                                            (name) => name !== branch,
                                          ),
                                    )
                                  }
                                />
                                <span>{t("Also delete the branch")}</span>
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </SettingsSection>
                  )}
                  {working.length > 0 && (
                    <SettingsSection
                      data-iori-removal-working={working
                        .map((work) => work.id)
                        .join(",")}
                      title={heading(t("Work in progress will be stopped"))}
                    >
                      <div className="section-rows">
                        {working.map((work) => (
                          <FieldRow
                            key={work.id}
                            label={<Name>{work.name}</Name>}
                            data-iori-removal-work={work.id}
                          >
                            <span data-iori-removal-work-state={work.state}>
                              {workStates[work.state]}
                            </span>
                          </FieldRow>
                        ))}
                      </div>
                    </SettingsSection>
                  )}
                </>
              )}
              {outcomes.map((item) => {
                const entry = tree.find(
                  (worktree) => worktree.path === item.path,
                );
                return (
                  <p key={item.path}>
                    {entry
                      ? name(entry)
                      : worktreeLabel(undefined, item.path, path)}
                    {": "}
                    {t(
                      item.error ?? (item.removed ? "Deleted" : "Not deleted"),
                    )}
                  </p>
                );
              })}
              {error && <p role="alert">{t(error)}</p>}
            </ScrollArea>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </Button>
          {error ? (
            <Button
              // A retry after a failed deletion is the action to take; a failed
              // read is a recovery step beside the reason, not the main button.
              variant={preview ? "default" : "outline"}
              data-iori-action="worktree-removal-retry"
              pending={loading}
              onClick={() => {
                setOutcomes([]);
                setReload((value) => value + 1);
              }}
            >
              {t("Retry")}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={loading || !selected.length}
              pending={busy}
              onClick={() => void remove()}
              data-iori-action="worktree-removal-confirm"
            >
              {t("Delete")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
