import { pickerClis } from "./cli-list.ts";
import { pickerTeams } from "./teams/team-data.ts";
import { requestTeamsList } from "./teams/teams-list-cache.ts";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type {
  CliListResult,
  FolderHistoryItem,
  HostInfo,
  ResultByMethod,
  TeamList,
  TerminalSummary,
  WorktreeCreation,
} from "@iori/protocol";
import { connection } from "./connection.ts";
import { CliLauncher } from "./CliLauncher.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { Textarea } from "./components/ui/textarea.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.tsx";

/** Values the screen opens with, as "Start with this Issue" fills them. */
export type WorktreePrefill = { name: string; instruction: string };
type Props = {
  host: HostInfo;
  folder: FolderHistoryItem;
  prefill?: WorktreePrefill;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (
    terminal: TerminalSummary,
    path: string,
    setupWorktree: boolean,
  ) => void;
  onAddCli: () => void;
  onOpenTeams: (teamId?: string) => void;
  t: (key: string) => string;
};
export function WorktreeCreator({
  host,
  folder,
  prefill,
  open,
  onOpenChange,
  onStarted,
  onAddCli,
  onOpenTeams,
  t,
}: Props) {
  const [options, setOptions] = useState<ResultByMethod["worktrees.options"]>();
  const [clis, setClis] = useState<CliListResult>();
  const [rawTeams, setRawTeams] = useState<TeamList>();
  const [teams, setTeams] = useState<TeamList>();
  const [terminals, setTerminals] = useState<ResultByMethod["terminal.list"]>();
  const [terminalStatus, setTerminalStatus] = useState<
    "loading" | "loaded" | "error"
  >("loading");
  const [name, setName] = useState(prefill?.name ?? "");
  const [instruction, setInstruction] = useState(prefill?.instruction ?? "");
  const [setupCommand, setSetupCommand] = useState("");
  const [base, setBase] = useState("");
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  // The pressed action while it waits for the Host: "create", "here", "check",
  // or the launcher item (`cli:…`, `team:…`, `shell:…`).
  const [pressed, setPressed] = useState<string>();
  const busy = pressed !== undefined;
  const [creationId, setCreationId] = useState<string>();
  const creationAttempt = useRef<ReturnType<Crypto["randomUUID"]>>(undefined);
  const [createdPath, setCreatedPath] = useState<string>();
  const nameInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const git = folder.kind === "git";
  const noCommits = git && !loading && !!options?.noCommits;
  const canCreate =
    !loading && !busy && !!choice && !!options && !options.noCommits;
  const alert =
    error ||
    (noCommits ? "Make the first commit, then you can create a worktree." : "");
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setTerminalStatus("loading");
    void Promise.all([
      connection.requestHost(host.publicKey, "cli.list", {}),
      requestTeamsList(host.publicKey),
      git
        ? connection.requestHost(host.publicKey, "worktrees.options", {
            path: folder.workspacePath,
          })
        : Promise.resolve(undefined),
      git
        ? Promise.resolve(undefined)
        : connection
            .requestHost(host.publicKey, "terminal.list", {})
            .catch(() => undefined),
    ])
      .then(([cli, team, opts, terminal]) => {
        if (!current) return;
        if (!git) {
          setTerminals(terminal?.ok ? terminal.result : undefined);
          setTerminalStatus(terminal?.ok ? "loaded" : "error");
        }
        if (!cli?.ok || !team?.ok || (git && !opts?.ok)) {
          setError("Could not load choices. Retry.");
          return;
        }
        // Only CLIs found on this Host can be launched.
        setClis(cli.result);
        setRawTeams(team.result);
        setTeams({ ...team.result, teams: pickerTeams(team.result.teams) });
        if (opts?.ok) {
          setOptions(opts.result);
          setSetupCommand(opts.result.setupCommand);
          setBase((value) => value || opts.result.defaultBranch);
        }
        const launchable = pickerClis(cli.result.clis);
        const defaultCli =
          launchable.find((item) => item.id === cli.result.lastUsedId) ??
          launchable[0];
        const selectableTeams = pickerTeams(team.result.teams);
        const defaultTeam = selectableTeams.find(
          (item) => item.saved.id === team.result.defaultTeam,
        );
        const selectedTeam = defaultTeam?.saved.parent.cli
          ? defaultTeam
          : defaultTeam
            ? selectableTeams.find((item) => item.saved.parent.cli)
            : undefined;
        const selection = selectedTeam
          ? `team:${selectedTeam.saved.id}`
          : defaultCli
            ? `cli:${defaultCli.id}`
            : "";
        setChoice((value) =>
          value.startsWith("team:") &&
          !selectableTeams.some(
            (item) => item.saved.id === value.slice(5) && item.saved.parent.cli,
          )
            ? selection
            : value || selection,
        );
        setError((value) =>
          value === "Could not load choices. Retry." ? "" : value,
        );
      })
      .catch(() => {
        if (current) setError("Could not load choices. Retry.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [host.publicKey, folder.workspacePath, git, reload, open]);

  const launch = async (
    path: string,
    selected = choice,
    setupWorktree = false,
  ) => {
    // An empty first instruction sends nothing (worktrees.md).
    const first = git && instruction.trim() ? { instruction } : {};
    const result = selected.startsWith("team:")
      ? await connection.requestHost(host.publicKey, "team.launch", {
          cwd: path,
          teamId: selected.slice(5),
          setupWorktree,
          ...first,
        })
      : selected.startsWith("shell:")
        ? await connection.requestHost(host.publicKey, "terminal.create", {
            cwd: path,
            shell: selected.slice(6),
          })
        : await connection.requestHost(host.publicKey, "cli.launch", {
            cwd: path,
            cliId: selected.slice(4),
            setupWorktree,
            ...first,
          });
    if (result?.ok) {
      onStarted(result.result.terminal, path, setupWorktree);
      onOpenChange(false);
    } else if (result)
      setError(
        "Could not start the CLI or team. Check its settings and try again.",
      );
  };
  const acceptCreation = async (result: WorktreeCreation) => {
    if (result.state === "created" && result.path) {
      setCreatedPath(result.path);
      creationAttempt.current = undefined;
      setCreationId(undefined);
      await launch(result.path, choice, true);
    } else if (result.state === "failed") {
      creationAttempt.current = undefined;
      setCreationId(undefined);
      setError(
        result.error === "name_conflict"
          ? "That branch or folder already exists. Choose another name."
          : result.error === "invalid_name"
            ? "This name cannot be used for a branch. Choose another name."
            : "Could not create the worktree. Check the repository and try again.",
      );
    }
  };
  const start = async (
    here: boolean,
    selected = choice,
    action = here ? "here" : "create",
  ) => {
    setPressed(action);
    setError("");
    try {
      if (here || createdPath)
        await launch(
          createdPath ?? options?.mainPath ?? folder.path,
          selected,
          !!createdPath,
        );
      else {
        const id = creationAttempt.current ?? crypto.randomUUID();
        creationAttempt.current = id;
        setCreationId(id);
        const response = await connection.requestHost(
          host.publicKey,
          "worktrees.create",
          { path: folder.workspacePath, name, baseBranch: base, setupCommand },
          id,
        );
        if (response?.ok) await acceptCreation(response.result);
        else if (response) {
          creationAttempt.current = undefined;
          setCreationId(undefined);
          setError(
            "Could not create the worktree. Check the repository and try again.",
          );
        }
      }
    } catch {
      /* Keep the creation receipt for a read-only reconciliation. */
    } finally {
      setPressed(undefined);
    }
  };
  const check = async () => {
    if (!creationId) return;
    setPressed("check");
    try {
      const response = await connection.requestHost(
        host.publicKey,
        "worktrees.creation",
        { creationId },
      );
      if (response?.ok) {
        if (response.result.creation)
          await acceptCreation(response.result.creation);
        else setCreationId(undefined); // No receipt: allow an explicit retry with the same operation ID.
      }
    } catch {
      // Keep the receipt; checking again only reads the result.
    } finally {
      setPressed(undefined);
    }
  };
  const close = () => {
    if (!busy && !creationId && !createdPath) {
      setName("");
      setInstruction("");
      setBase("");
      setChoice("");
      setError("");
      setOptions(undefined);
      creationAttempt.current = undefined;
    }
    onOpenChange(false);
  };
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          className="dialog-full-screen max-h-[calc(100dvh-1.5rem)] w-[min(35rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-border bg-popover shadow-md sm:max-w-[35rem] [&_[data-slot=dialog-description]]:[overflow-wrap:anywhere] [&_[data-slot=dialog-footer]]:flex-wrap [&_[data-slot=dialog-header]]:pr-7"
          onKeyDown={(event) => {
            if (
              git &&
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey) &&
              !event.defaultPrevented &&
              !event.nativeEvent.isComposing &&
              canCreate &&
              !(creationId && pressed !== "create")
            ) {
              event.preventDefault();
              void start(false);
            }
          }}
          onOpenAutoFocus={(event) => {
            if (git && nameInput.current && !nameInput.current.disabled) {
              event.preventDefault();
              nameInput.current.focus();
            }
          }}
          showCloseButton={false}
          data-iori-view="worktree-create"
        >
          <DialogHeader>
            <DialogTitle>
              {t(git ? "New worktree" : "Start CLI or team")}
            </DialogTitle>
            <DialogDescription>{folder.workspacePath}</DialogDescription>
          </DialogHeader>
          <Button
            className="absolute top-2 right-2 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
            data-slot="dialog-close"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Close")}
            title={t("Close")}
            data-iori-action="worktree-create-close"
            onClick={close}
          >
            <X size={16} />
          </Button>
          {git ? (
            <>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                {t("Name (optional)")}
                <Input
                  ref={nameInput}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.defaultPrevented &&
                      !event.nativeEvent.isComposing &&
                      canCreate &&
                      !creationId &&
                      !createdPath
                    ) {
                      event.preventDefault();
                      void start(false);
                    }
                  }}
                  data-iori-field="worktree-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy || !!creationId || !!createdPath}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground [&_[data-slot=select-trigger]]:w-full">
                {t("Base branch")}
                <Select
                  value={base}
                  onValueChange={setBase}
                  disabled={busy || !!creationId || !!createdPath}
                >
                  <SelectTrigger data-iori-field="worktree-base">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options?.branches.map((branch) => (
                      <SelectItem
                        key={branch}
                        value={branch}
                        data-iori-base-branch={branch}
                      >
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                {t("Command to run after creating a worktree")}
                <Input
                  data-iori-field="worktree-setup-command"
                  value={setupCommand}
                  onChange={(event) => setSetupCommand(event.target.value)}
                  disabled={loading || busy || !!creationId || !!createdPath}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground [&_[data-slot=select-trigger]]:w-full">
                {t("CLI or team")}
                <Select
                  value={choice}
                  onValueChange={setChoice}
                  disabled={busy || !!creationId}
                >
                  <SelectTrigger data-iori-field="worktree-launcher">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>CLI</SelectLabel>
                      {pickerClis(clis?.clis ?? []).map((cli) => (
                        <SelectItem
                          key={cli.id}
                          value={`cli:${cli.id}`}
                          data-iori-launch-choice={`cli:${cli.id}`}
                        >
                          {cli.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {teams && teams.teams.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>{t("Teams")}</SelectLabel>
                        {teams.teams.map(({ saved: team }) => (
                          <SelectItem
                            key={team.id}
                            value={`team:${team.id}`}
                            data-iori-launch-choice={`team:${team.id}`}
                            disabled={!team.parent.cli}
                          >
                            {team.name} ·{" "}
                            {team.parent.cli
                              ? (clis?.clis.find(
                                  (cli) => cli.id === team.parent.cli,
                                )?.name ?? team.parent.cli)
                              : t("Choose an orchestrator CLI")}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground [&_textarea]:min-h-[5.25rem]">
                {t("First instruction (optional)")}
                <Textarea
                  rows={3}
                  data-iori-field="worktree-instruction"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  disabled={busy || !!creationId}
                />
              </label>
            </>
          ) : (
            clis && (
              <CliLauncher
                className="w-full"
                hostKey={host.publicKey}
                preloadedTeams={rawTeams}
                t={t}
                clis={pickerClis(clis.clis)}
                shells={terminals?.shells ?? []}
                defaultShellId={terminals?.defaultShell}
                status={terminalStatus}
                onRetry={() => setReload((v) => v + 1)}
                pending={pressed}
                onCli={(cli) =>
                  void start(true, `cli:${cli.id}`, `cli:${cli.id}`)
                }
                onTeam={(team) =>
                  void start(true, `team:${team.id}`, `team:${team.id}`)
                }
                onShell={(shell) =>
                  void start(true, `shell:${shell.id}`, `shell:${shell.id}`)
                }
                onAddCli={onAddCli}
                onOpenTeams={onOpenTeams}
              />
            )
          )}
          {alert && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-xs text-status-failed-text [overflow-wrap:anywhere]"
            >
              <span>{t(alert)}</span>
              {error && !clis && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReload((v) => v + 1)}
                >
                  {t("Retry")}
                </Button>
              )}
            </div>
          )}
          {git && (
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={close}>
                {t("Cancel")}
              </Button>
              {creationId && pressed !== "create" ? (
                <Button
                  data-iori-action="worktree-create-check"
                  pending={pressed === "check"}
                  onClick={() => void check()}
                >
                  {t("Check creation result")}
                </Button>
              ) : (
                <>
                  {!createdPath && (
                    <Button
                      variant="outline"
                      data-iori-action="worktree-create-here"
                      disabled={loading || busy || !choice || !options}
                      pending={pressed === "here"}
                      onClick={() => void start(true)}
                    >
                      {t("Here (without a worktree)")}
                    </Button>
                  )}
                  <Button
                    data-iori-action="worktree-create"
                    disabled={!canCreate}
                    pending={pressed === "create"}
                    onClick={() => void start(false)}
                  >
                    {t(createdPath ? "Start" : "Create worktree")}
                  </Button>
                </>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
