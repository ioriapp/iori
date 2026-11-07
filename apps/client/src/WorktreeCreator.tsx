import { pickerClis } from "./cli-list.ts";
import { pickerTeams } from "./teams/team-data.ts";
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
import "./worktree-creator.css";

/** Values the screen opens with, as "Start with this Issue" fills them. */
export type WorktreePrefill = { name: string; instruction: string };
type Props = {
  host: HostInfo;
  folder: FolderHistoryItem;
  prefill?: WorktreePrefill;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (terminal: TerminalSummary) => void;
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
  const [teams, setTeams] = useState<TeamList>();
  const [terminals, setTerminals] = useState<ResultByMethod["terminal.list"]>();
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
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    void Promise.all([
      connection.requestHost(host.publicKey, "cli.list", {}),
      connection.requestHost(host.publicKey, "teams.list", {}),
      git
        ? connection.requestHost(host.publicKey, "worktrees.options", {
            path: folder.workspacePath,
          })
        : Promise.resolve(undefined),
      git
        ? Promise.resolve(undefined)
        : connection.requestHost(host.publicKey, "terminal.list", {}),
    ])
      .then(([cli, team, opts, terminal]) => {
        if (!current) return;
        if (!cli?.ok || !team?.ok || (git && !opts?.ok)) {
          setError("Could not load choices. Retry.");
          return;
        }
        // Only CLIs found on this Host can be launched.
        setClis(cli.result);
        setTeams({ ...team.result, teams: pickerTeams(team.result.teams) });
        if (opts?.ok) {
          setOptions(opts.result);
          setSetupCommand(opts.result.setupCommand);
          setBase((value) => value || opts.result.defaultBranch);
        }
        if (terminal?.ok) setTerminals(terminal.result);
        const launchable = pickerClis(cli.result.clis);
        const defaultCli =
          launchable.find((item) => item.id === cli.result.lastUsedId) ??
          launchable[0];
        const selectableTeams = pickerTeams(team.result.teams);
        const defaultTeam = team.result.enabled
          ? selectableTeams.find(
              (item) => item.saved.id === team.result.defaultTeam,
            )
          : undefined;
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
      onStarted(result.result.terminal);
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
          className="folder-dialog worktree-create-dialog dialog-full-screen"
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
            className="worktree-create-close"
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
              <label className="worktree-create-field">
                {t("Name (optional)")}
                <Input
                  ref={nameInput}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.nativeEvent.isComposing &&
                      !loading &&
                      !busy &&
                      !creationId &&
                      !createdPath &&
                      choice &&
                      options
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
              <label className="worktree-create-field">
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
              <label className="worktree-create-field">
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
              <label className="worktree-create-field">
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
                    {teams?.enabled && (
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
                              : t("Choose a parent CLI")}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </label>
              <label className="worktree-create-field">
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
                hostKey={host.publicKey}
                t={t}
                clis={pickerClis(clis.clis)}
                shells={terminals?.shells ?? []}
                defaultShellId={terminals?.defaultShell}
                status={terminals ? "loaded" : "loading"}
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
          {error && (
            <div role="alert">
              {t(error)}
              {!clis && (
                <Button
                  variant="outline"
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
                    disabled={loading || busy || !choice || !options}
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
