import { useEffect, useRef, useState } from "react";
import type {
  HostInfo,
  WorktreeRemovalItem,
  WorktreeRemovalPreview,
  WorktreeRemovalWorking,
} from "@iori/protocol";
import { CircleAlert, TriangleAlert } from "lucide-react";
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
  DialogBody,
} from "./components/ui/dialog.tsx";
import { NoticeOriginal } from "./components/flow/Toast.tsx";
import {
  removalTree,
  removalReason,
  worktreeRemovalFlow,
  type RemovalFailure,
} from "./worktree-removal-flow.ts";
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
  onStarted: (paths: string[]) => void;
  failures?: RemovalFailure[];
  initialPreviews?: WorktreeRemovalPreview[];
};
export function WorktreeRemoval({
  host,
  path,
  cleanup,
  label,
  t,
  onClose,
  onRemoved,
  onStarted,
  failures,
  initialPreviews,
}: Props) {
  const [previews, setPreviews] = useState<WorktreeRemovalPreview[]>([]);
  const preview = previews[0];
  const items = previews.flatMap((item) => item.items);
  const multiple =
    cleanup ||
    Boolean(failures && failures.length > 1) ||
    Boolean(
      initialPreviews &&
      initialPreviews.flatMap((entry) => entry.items).length > 1,
    );
  const cancel = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failedPreviews, setFailedPreviews] = useState<RemovalFailure[]>([]);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    if (initialPreviews) {
      setPreviews(initialPreviews);
      setSelected(
        initialPreviews.flatMap((entry) =>
          entry.items.map((item) => item.path),
        ),
      );
      setBranches([]);
      setError("");
      setLoading(false);
      return () => {
        current = false;
      };
    }
    const reads =
      failures && multiple
        ? failures.map((failure) =>
            connection.requestHost(host.publicKey, "worktrees.preview", {
              path: failure.path,
            }),
          )
        : [
            connection.requestHost(
              host.publicKey,
              cleanup ? "worktrees.cleanup" : "worktrees.preview",
              { path },
            ),
          ];
    void Promise.allSettled(reads).then((responses) => {
      if (!current) return;
      const loaded = responses.flatMap((response) =>
        response.status === "fulfilled" && response.value?.ok
          ? [response.value.result]
          : [],
      );
      setFailedPreviews(
        failures && multiple
          ? failures.filter((_, index) => {
              const response = responses[index];
              return response.status !== "fulfilled" || !response.value?.ok;
            })
          : [],
      );
      setPreviews(loaded);
      setSelected(
        loaded.flatMap((entry) =>
          entry.items
            .filter(
              (item) =>
                !(failures && multiple) ||
                !removalTree([item]).some(
                  (tree) =>
                    tree.changes.files > 0 ||
                    (tree.detachedCommits ?? 0) > 0 ||
                    (!tree.deleteBranch && (tree.commits ?? 0) > 0),
                ),
            )
            .map((item) => item.path),
        ),
      );
      setBranches([]);
      setError(
        loaded.length || (failures && multiple)
          ? ""
          : "Could not load worktrees. Check Git and retry.",
      );
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [
    host.publicKey,
    path,
    cleanup,
    failures,
    multiple,
    reload,
    initialPreviews,
  ]);
  const remove = () => {
    if (!preview) return;
    const paths = removalTree(
      items.filter((item) => selected.includes(item.path)),
    ).map((item) => item.path);
    onStarted(paths);
    void worktreeRemovalFlow.remove({
      target: { host, path, cleanup, label },
      previews,
      paths: selected,
      branches,
      t,
      onRemoved,
    });
    onClose();
  };
  const selectedRoots = items.filter((item) => selected.includes(item.path));
  const tree = [
    ...new Map(
      removalTree(selectedRoots).map((item) => [item.path, item]),
    ).values(),
  ];
  const name = (item: WorktreeRemovalItem) =>
    worktreeLabel(item.branch, item.path, path);
  const changed = tree.filter((item) => item.changes.files > 0);
  const detached = tree.filter(
    (item) => (item.detachedCommits ?? 0) > 0 && !item.rebasingBranch,
  );
  const rebasing = tree.filter(
    (item) => (item.detachedCommits ?? 0) > 0 && item.rebasingBranch,
  );
  const lost = tree.filter(
    (item) => item.branch && !item.deleteBranch && (item.commits ?? 0) > 0,
  );
  const target = lost.find((item) => item.target)?.target;
  const working = [
    ...new Map(
      previews
        .filter((entry) =>
          entry.items.some((item) => selected.includes(item.path)),
        )
        .flatMap((entry) => entry.working ?? [])
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const root = preview?.items[0];
  const count = failures ? tree.length : selectedRoots.length;
  // With nothing to decide, the confirmation keeps only the line that names the
  // worktree: no empty body.
  const body =
    loading ||
    Boolean(error) ||
    Boolean(failures?.length) ||
    previews.some((item) => item.fetchFailed) ||
    items.length === 0 ||
    (multiple
      ? items.length > 0
      : changed.length > 0 ||
        detached.length > 0 ||
        rebasing.length > 0 ||
        working.length > 0 ||
        lost.length > 0);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="folder-dialog worktree-create-dialog removal-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLTextAreaElement>(
                '.workspace-content:not([hidden]) [data-iori-view="terminal"][data-iori-displayed="true"] .xterm-helper-textarea',
              )
              ?.focus({ preventScroll: true }),
          );
        }}
        data-iori-view="worktree-removal"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {t(cleanup ? "Delete merged worktrees?" : "Delete worktree?")}
          </DialogTitle>
          {multiple ? (
            !loading &&
            items.length > 0 && (
              <DialogDescription className="worktree-removal-summary">
                {countText(t, "{count} worktrees will be deleted.", count)}
              </DialogDescription>
            )
          ) : (
            <DialogDescription className="worktree-removal-summary">
              {t("{name} will be deleted.").replace(
                "{name}",
                () =>
                  label ??
                  (root ? name(root) : worktreeLabel(undefined, path, path)),
              )}
            </DialogDescription>
          )}
        </DialogHeader>
        {body && (
          // Only the body scrolls when it overflows; the title and buttons
          // stay in place.
          <DialogBody>
            {failures &&
              !multiple &&
              failures.map((failure) => (
                <PreviousFailure key={failure.path} failure={failure} t={t} />
              ))}
            {previews.some((entry) => entry.fetchFailed) && (
              <p role="status" data-iori-fetch-warning="true">
                {t(
                  "Fetch failed. Merged worktrees are checked against local references, which may be out of date.",
                )}
              </p>
            )}
            {loading ? (
              <p>
                {t(
                  cleanup && !failures
                    ? "Fetching and checking worktrees…"
                    : "Loading…",
                )}
              </p>
            ) : items.length === 0 && !error && failedPreviews.length === 0 ? (
              <p>{t("No merged worktrees to delete.")}</p>
            ) : multiple ? (
              <div className="section-body">
                <div className="section-rows">
                  {items.map((item) => (
                    <div
                      key={item.path}
                      className="field-row removal-merged-item"
                    >
                      <label
                        className="worktree-removal-select"
                        data-iori-removal-candidate={item.path}
                      >
                        <Checkbox
                          checked={selected.includes(item.path)}
                          disabled={selectedRoots.some(
                            (parent) =>
                              parent.path !== item.path &&
                              removalTree(parent.worktrees).some(
                                (child) => child.path === item.path,
                              ),
                          )}
                          data-iori-removal-select={item.path}
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked
                                ? [
                                    ...new Set([
                                      ...current,
                                      ...items
                                        .filter((candidate) =>
                                          removalTree([item]).some(
                                            (child) =>
                                              child.path === candidate.path,
                                          ),
                                        )
                                        .map((candidate) => candidate.path),
                                    ]),
                                  ]
                                : current.filter((path) => path !== item.path),
                            )
                          }
                        />
                        <Name middle data-iori-removal-name={item.path}>
                          {name(item)}
                        </Name>
                      </label>
                      {failures
                        ?.filter((failure) => failure.path === item.path)
                        .map((failure) => (
                          <PreviousFailure
                            key={failure.path}
                            failure={failure}
                            t={t}
                          />
                        ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!loading && failedPreviews.length > 0 && (
              <div className="section-body">
                {failedPreviews.map((failure) => (
                  <div
                    key={failure.path}
                    className="field-row removal-merged-item"
                  >
                    <Name middle>
                      {worktreeLabel(undefined, failure.path, path)}
                    </Name>
                    <PreviousFailure failure={failure} t={t} />
                  </div>
                ))}
                <p role="alert">
                  {t("Could not load worktrees. Check Git and retry.")}
                </p>
                <Button
                  variant="outline"
                  onClick={() => setReload((value) => value + 1)}
                >
                  {t("Retry")}
                </Button>
              </div>
            )}
            {(!cleanup || failures) && !loading && (
              <>
                {changed.length > 0 && (
                  <SettingsSection
                    data-iori-removal-changes={changed
                      .map((item) => item.path)
                      .join(",")}
                    title={heading(t("Uncommitted changes will be lost"), true)}
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
                {rebasing.length > 0 && (
                  <SettingsSection
                    data-iori-removal-rebasing={rebasing
                      .map((item) => item.path)
                      .join(",")}
                    title={heading(
                      t("Commits made by a rebase in progress will be lost"),
                      true,
                    )}
                  >
                    <div className="section-rows">
                      {rebasing.map((item) => (
                        <FieldRow
                          key={item.path}
                          label={<Name middle>{name(item)}</Name>}
                          description={t(
                            "Original commits stay on {branch}",
                          ).replace("{branch}", () => item.rebasingBranch!)}
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
                        () => target ?? "",
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
            {error && <p role="alert">{t(error)}</p>}
          </DialogBody>
        )}
        <DialogFooter>
          <Button ref={cancel} variant="outline" onClick={onClose}>
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
                setReload((value) => value + 1);
              }}
            >
              {t("Retry")}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={loading || !selected.length}
              onClick={remove}
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

function PreviousFailure({
  failure,
  t,
}: {
  failure: RemovalFailure;
  t: (key: string) => string;
}) {
  return (
    <div className="removal-previous" role="alert">
      <CircleAlert aria-hidden="true" />
      <div>
        <p>
          {t("Could not delete it last time. {reason}").replace(
            "{reason}",
            () => removalReason(failure, t),
          )}
        </p>
        {failure.stopped && (
          <p className="removal-stopped">
            {t("The CLI and Terminal in this worktree were stopped.")}
          </p>
        )}
        {!failure.locked && failure.gitOutput && (
          <NoticeOriginal text={failure.gitOutput} t={t} reserve />
        )}
      </div>
    </div>
  );
}
