import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
  Automation,
  AutomationDefinition,
  AutomationList,
  AutomationReceived,
  AutomationRun,
  Event,
  ForgeReadFailure,
  Response,
  TerminalCreatedResult,
} from "@iori/protocol";
import { issueWorktreeName } from "@iori/protocol";
import { repositoryIssues } from "../forge-issues.ts";
import { ForgeReadError, forgeReadFailure } from "../forge/failure.ts";
import type { ForgeDetection } from "../forge/adapters.ts";
import type { IssueMarkCache } from "../forge/issues.ts";
import {
  inventory,
  worktreeOptions,
  WorktreeCreator,
  worktreeSetup,
} from "../worktree-creation.ts";
import type { HostStore, StoreContext } from "../store.ts";
import type { TerminalManager } from "../terminal/manager.ts";
import type { TeamManager } from "../teams/manager.ts";
import { dueSchedules, nextSchedule } from "./schedule.ts";
import { AutomationWebhookServer } from "./webhook.ts";
import { webhookInstruction } from "./received.ts";
export class AutomationManager {
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  #timer?: ReturnType<typeof setTimeout>;
  #closed = false;
  #nextIssuePoll = 0;
  readonly #issuePolling = new Map<string, Promise<void>>();
  readonly #issueAbort = new AbortController();
  readonly #issueCache = new Map<
    string,
    { key: string; entries: IssueMarkCache }
  >();
  readonly #issueRevisions = new Map<string, number>();
  readonly #issueErrors = new Map<string, ForgeReadFailure | "no-forge">();
  #tail: Promise<unknown> = Promise.resolve();
  readonly #webhook: AutomationWebhookServer;
  readonly detection: ForgeDetection;
  readonly worktrees: WorktreeCreator;
  readonly root: string;
  readonly store: HostStore;
  readonly terminals: () => TerminalManager;
  readonly teams: () => TeamManager;
  readonly publish: (event: Event) => void;
  constructor(
    store: HostStore,
    terminals: () => TerminalManager,
    teams: () => TeamManager,
    publish: (event: Event) => void,
    root: string,
    port: number,
    detection: ForgeDetection,
    worktrees: WorktreeCreator,
  ) {
    this.detection = detection;
    this.worktrees = worktrees;
    this.root = root;
    this.store = store;
    this.terminals = terminals;
    this.teams = teams;
    this.publish = publish;
    this.#webhook = new AutomationWebhookServer(
      port,
      store,
      (id, received, respond) => this.receiveWebhook(id, received, respond),
    );
  }
  start(): Promise<void> {
    return this.#serial(async () => {
      try {
        await this.#webhook.sync();
        await this.#drain(true);
        this.#startIssuePoll();
      } finally {
        this.#arm();
      }
    });
  }
  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#issueAbort.abort();
    await Promise.all(this.#issuePolling.values());
    await this.#tail;
    await this.#webhook.close();
  }
  #serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.#tail.then(action);
    this.#tail = operation.catch(() => {});
    return operation;
  }
  list(): AutomationList {
    if (this.#webhook.info()?.error === "port") {
      void this.#serial(async () => {
        if (this.#webhook.info()?.error !== "port") return;
        await this.#webhook.sync();
        if (this.#webhook.info()?.error !== "port")
          this.publish({ type: "automation.changed" });
      }).catch(() => {});
    }
    if (this.#issueErrors.size) {
      void this.#serial(async () => {
        for (const automation of this.store.automations()) {
          if (this.#issueErrors.has(automation.id))
            this.#startIssuePollFor(automation);
        }
      }).catch(() => {});
    }
    return {
      timeZone: this.timeZone,
      webhook: this.#webhook.info(),
      automations: this.store.automations().map((automation) => ({
        ...automation,
        lastRun: this.store.automationRuns(automation.id)[0],
        ...(this.#issueErrors.has(automation.id)
          ? { issueError: this.#issueErrors.get(automation.id) }
          : {}),
      })),
    };
  }
  save(
    context: StoreContext,
    id: string | undefined,
    definition: AutomationDefinition,
  ): Promise<Response<{ automation: Automation }>> {
    return this.#serial(async () => {
      const previous = this.store.terminalOperationResult<{
        automation: Automation;
      }>(context);
      if (previous) return { ok: true, result: previous };
      await this.#drain(false);
      const old = this.store.automations().find((a) => a.id === id);
      if (id && !old) return { ok: false, error: { code: "invalid_request" } };
      const nextAt =
        old &&
        JSON.stringify(old.schedule) === JSON.stringify(definition.schedule)
          ? old.nextAt
          : definition.schedule.kind === "once"
            ? definition.schedule.at
            : nextSchedule(definition.schedule, Date.now(), this.timeZone);
      let automation: Automation = {
        ...definition,
        id: id ?? randomUUID(),
        ...(nextAt === undefined ? {} : { nextAt }),
      };
      this.store.putAutomation(automation);
      this.#issueErrors.delete(automation.id);
      this.#issueRevisions.set(
        automation.id,
        (this.#issueRevisions.get(automation.id) ?? 0) + 1,
      );
      if (
        old?.cwd !== automation.cwd ||
        old?.issue?.label !== automation.issue?.label
      )
        this.#issueCache.delete(automation.id);
      automation = this.store
        .automations()
        .find((a) => a.id === automation.id)!;
      const result = { automation };
      this.store.saveTerminalOperationResult(context, result);
      await this.#webhook.sync();
      this.publish({ type: "automation.changed" });
      this.#arm();
      return { ok: true, result };
    });
  }
  remove(context: StoreContext, id: string): Promise<Response<{ id: string }>> {
    return this.#serial(async () => {
      const previous = this.store.terminalOperationResult<{ id: string }>(
        context,
      );
      if (previous) return { ok: true, result: previous };
      this.store.deleteAutomation(id);
      this.#issueRevisions.set(id, (this.#issueRevisions.get(id) ?? 0) + 1);
      this.#issueCache.delete(id);
      this.#issueErrors.delete(id);
      const directory = join(this.root, "automation-files", id);
      const files = await readdir(directory).catch(() => []);
      await Promise.all(
        files
          .filter((file) => file.endsWith(".received.json"))
          .map((file) => unlink(join(directory, file)).catch(() => {})),
      );
      const result = { id };
      this.store.saveTerminalOperationResult(context, result);
      await this.#webhook.sync();
      this.publish({ type: "automation.changed" });
      this.#arm();
      return { ok: true, result };
    });
  }
  regenerateToken(
    context: StoreContext,
    id: string,
  ): Promise<Response<{ automation: Automation }>> {
    return this.#serial(async () => {
      const previous = this.store.terminalOperationResult<{
        automation: Automation;
      }>(context);
      if (previous) return { ok: true, result: previous };
      const automation = this.store.automations().find((a) => a.id === id);
      if (!automation?.webhook)
        return { ok: false, error: { code: "invalid_request" } };
      this.store.regenerateAutomationToken(id);
      const result = {
        automation: this.store.automations().find((a) => a.id === id)!,
      };
      this.store.saveTerminalOperationResult(context, result);
      this.publish({ type: "automation.changed" });
      return { ok: true, result };
    });
  }
  received(id: string): Promise<Response<{ received: AutomationReceived }>> {
    return this.#serial(async () => {
      const run = this.store.automationRun(id);
      if (run?.trigger !== "webhook")
        return { ok: false, error: { code: "invalid_request" } };
      const received: AutomationReceived = JSON.parse(
        await readFile(this.#receivedFile(run), "utf8"),
      );
      return { ok: true, result: { received } };
    });
  }
  receiveWebhook(
    id: string,
    received: AutomationReceived,
    respond: (run: AutomationRun) => void,
  ): Promise<boolean> {
    return this.#serial(async () => {
      if (this.#closed) return false;
      const automation = this.store.automations().find((a) => a.id === id);
      if (!automation?.webhook) return false;
      const run: AutomationRun = {
        id: randomUUID(),
        automationId: id,
        trigger: "webhook",
        scheduledAt: received.receivedAt,
        from: received.from,
        ...(!automation.enabled
          ? { reason: "disabled" as const }
          : this.#busy(automation)
            ? { reason: "busy" as const }
            : {}),
      };
      const directory = join(this.root, "automation-files", id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(this.#receivedFile(run), JSON.stringify(received), {
        mode: 0o600,
      });
      this.store.claimAutomationRun(run);
      this.publish({ type: "automation.changed" });
      respond(run);
      if (!run.reason) {
        await this.#launch(automation, run, received);
        this.publish({ type: "automation.changed" });
      }
      return true;
    });
  }
  #receivedFile(run: AutomationRun): string {
    return join(
      this.root,
      "automation-files",
      run.automationId,
      `${run.id}.received.json`,
    );
  }
  run(
    context: StoreContext,
    id: string,
  ): Promise<Response<{ run: AutomationRun }>> {
    return this.#serial(async () => {
      const previous = this.store.terminalOperationResult<{
        run: AutomationRun;
      }>(context);
      if (previous) return { ok: true, result: previous };
      const automation = this.store.automations().find((a) => a.id === id);
      if (!automation) return { ok: false, error: { code: "invalid_request" } };
      const runId = `manual:${context.clientPublicKey}:${context.operationId}`;
      const stored = this.store.automationRuns(id).find((r) => r.id === runId);
      const run =
        stored ??
        (await this.#execute(automation, {
          id: runId,
          automationId: id,
          scheduledAt: Date.now(),
          trigger: "manual",
        }));
      const result = { run };
      this.store.saveTerminalOperationResult(context, result);
      return { ok: true, result };
    });
  }
  async #drain(starting: boolean): Promise<void> {
    const now = Date.now();
    for (const automation of this.store.automations()) {
      if (this.#closed) break;
      const due = dueSchedules(automation, now, this.timeZone, starting);
      for (const occurrence of due) {
        const run: AutomationRun = {
          id: randomUUID(),
          automationId: automation.id,
          trigger: "schedule",
          scheduledAt: occurrence.at,
          ...(occurrence.reason ? { reason: occurrence.reason } : {}),
        };
        // Claim before launching. A crash leaves this occurrence consumed even
        // when the Host never learned whether the CLI actually started.
        const claimed = this.store.claimAutomationRun(run);
        automation.nextAt = nextSchedule(
          automation.schedule,
          occurrence.at,
          this.timeZone,
        );
        if (automation.schedule.kind === "once") automation.enabled = false;
        this.store.putAutomation(automation);
        if (claimed && !run.reason) await this.#launch(automation, run);
        this.publish({ type: "automation.changed" });
      }
    }
    this.#arm();
  }
  #arm(): void {
    clearTimeout(this.#timer);
    if (this.#closed) return;
    const automations = this.store.automations();
    const dates = automations.flatMap((a) =>
      a.nextAt === undefined ? [] : [a.nextAt],
    );
    if (automations.some((a) => a.enabled && a.issue))
      dates.push(this.#nextIssuePoll || Date.now() + 60_000);
    if (!dates.length) return;
    // Claude Code Desktop checks schedules every minute:
    // https://code.claude.com/docs/en/desktop-scheduled-tasks#how-scheduled-tasks-run
    // Recheck wall time within 60 seconds after sleep; nearer dates stay exact.
    const delay = Math.min(
      60_000,
      Math.max(0, Math.min(...dates) - Date.now()),
    );
    this.#timer = setTimeout(() => {
      void this.#serial(async () => {
        try {
          await this.#drain(false);
          if (Date.now() >= this.#nextIssuePoll) this.#startIssuePoll();
        } finally {
          this.#arm();
        }
      }).catch(() => {
        console.error("Automation scheduling could not be saved");
      });
    }, delay);
    this.#timer.unref();
  }
  #startIssuePoll(): void {
    this.#nextIssuePoll = Date.now() + 60_000;
    if (this.#closed) return;
    for (const snapshot of this.store.automations())
      this.#startIssuePollFor(snapshot);
  }
  #startIssuePollFor(snapshot: Automation): void {
    if (
      this.#closed ||
      !snapshot.enabled ||
      !snapshot.issue ||
      this.#issuePolling.has(snapshot.id)
    )
      return;
    const task = this.#pollIssue(snapshot)
      .catch(() => {
        console.error("Automation issue polling failed");
      })
      .finally(() => {
        this.#issuePolling.delete(snapshot.id);
      });
    this.#issuePolling.set(snapshot.id, task);
  }
  async #pollIssue(snapshot: Automation): Promise<void> {
    if (this.#closed || !snapshot.enabled || !snapshot.issue) return;
    const revision = this.#issueRevisions.get(snapshot.id);
    const since = this.store.automationIssueStart(snapshot.id)!;
    let issues: Awaited<ReturnType<typeof repositoryIssues>>;
    try {
      issues = await repositoryIssues(
        snapshot.cwd,
        this.store,
        this.detection,
        this.#issueAbort.signal,
        true,
        true,
      );
      if (!issues) {
        await this.#serial(async () => {
          if (this.#currentIssueAutomation(snapshot, revision, since))
            this.#setIssueError(snapshot.id, "no-forge");
        });
        return;
      }
      const { target } = issues;
      const key = JSON.stringify([
        target.origin,
        target.owner,
        target.repo,
        snapshot.issue.label,
      ]);
      const saved = this.#issueCache.get(snapshot.id);
      const result = await issues.reader.issueMarks(
        target,
        snapshot.issue.label,
        issues.context,
        saved?.key === key ? saved.entries : new Map(),
      );
      const resolvedIssues = issues;
      await this.#serial(async () => {
        const automation = this.#currentIssueAutomation(
          snapshot,
          revision,
          since,
        );
        if (!automation) return;
        this.#issueCache.set(automation.id, { key, entries: result.cache });
        this.#setIssueError(automation.id, undefined);
        if (this.#busy(automation)) return;
        const runs = this.store.automationRuns(automation.id);
        const mark = result.marks
          .filter(
            (value) =>
              value.at >= Math.floor(since / 1000) * 1000 &&
              value.login &&
              value.login.toLowerCase() === value.account.toLowerCase() &&
              !runs.some(
                (run) =>
                  run.trigger === "issue" &&
                  run.issue?.number === value.issue.number &&
                  run.scheduledAt === value.at,
              ),
          )
          .sort((a, b) => a.at - b.at)[0];
        if (!mark) return;
        const run: AutomationRun = {
          id: randomUUID(),
          automationId: automation.id,
          trigger: "issue",
          scheduledAt: mark.at,
          issue: {
            number: mark.issue.number,
            title: mark.issue.title,
            url: mark.issue.url,
          },
        };
        this.store.claimAutomationRun(run);
        this.publish({ type: "automation.changed" });
        try {
          const { mainPath, defaultBranch } = await worktreeOptions(
            resolvedIssues.context.mainPath,
          );
          const name = issueWorktreeName(mark.issue.number, mark.issue.title);
          const existing = (await inventory(mainPath)).find(
            (entry) =>
              resolve(entry.path) ===
              join(dirname(mainPath), `${basename(mainPath)}-${name}`),
          );
          let cwd = existing?.path;
          let setup = false;
          if (!cwd) {
            const creation = await this.worktrees.create(
              {
                clientPublicKey: "automation",
                operationId: `${run.id}:worktree`,
              },
              mainPath,
              name,
              defaultBranch,
              this.store.worktreeSetupCommand(mainPath),
              true,
            );
            if (creation.state !== "created" || !creation.path)
              throw new Error("Could not create worktree");
            cwd = creation.path;
            setup = true;
            this.publish({ type: "folders.changed" });
          }
          await this.#launch({ ...automation, cwd }, run, undefined, setup);
        } catch {
          run.launchError =
            "Could not start the agent for this issue. Remove the label and add it again.";
          this.store.putAutomationRun(run);
        }
        this.publish({ type: "automation.changed" });
      });
    } catch (error) {
      if (this.#closed) return;
      await this.#serial(async () => {
        if (!this.#currentIssueAutomation(snapshot, revision, since)) return;
        this.#setIssueError(
          snapshot.id,
          issues
            ? forgeReadFailure(
                error,
                issues.target.origin,
                `${issues.target.owner}/${issues.target.repo}`,
              )
            : error instanceof ForgeReadError
              ? error.failure
              : "no-forge",
        );
      });
    }
  }
  #currentIssueAutomation(
    snapshot: Automation,
    revision: number | undefined,
    since: number,
  ): Automation | undefined {
    if (
      this.#closed ||
      this.#issueRevisions.get(snapshot.id) !== revision ||
      this.store.automationIssueStart(snapshot.id) !== since
    )
      return undefined;
    const current = this.store.automations().find((a) => a.id === snapshot.id);
    return current?.enabled &&
      current.issue &&
      current.cwd === snapshot.cwd &&
      current.issue.label === snapshot.issue?.label
      ? current
      : undefined;
  }
  #setIssueError(
    id: string,
    error: ForgeReadFailure | "no-forge" | undefined,
  ): void {
    const previous = this.#issueErrors.get(id);
    if (error) this.#issueErrors.set(id, error);
    else this.#issueErrors.delete(id);
    if (JSON.stringify(previous) !== JSON.stringify(error))
      this.publish({ type: "automation.changed" });
  }
  async #execute(
    automation: Automation,
    run: AutomationRun,
  ): Promise<AutomationRun> {
    this.store.claimAutomationRun(run);
    await this.#launch(automation, run);
    this.publish({ type: "automation.changed" });
    return run;
  }
  #busy(automation: Automation): boolean {
    const previous = this.store
      .automationRuns(automation.id)
      .find((r) => r.terminalId);
    const terminals = this.terminals().list();
    const terminal = terminals.ok
      ? terminals.result.terminals.find((t) => t.id === previous?.terminalId)
      : undefined;
    return (
      !!terminal &&
      ((!terminal.cliStatus && !!terminal.cli && !terminal.cliResumePending) ||
        terminal.cliStatus?.state === "active" ||
        terminal.cliStatus?.state === "waiting")
    );
  }
  async #launch(
    automation: Automation,
    run: AutomationRun,
    received?: AutomationReceived,
    setupWorktree = false,
  ): Promise<void> {
    if (run.trigger === "schedule" && this.#busy(automation)) {
      run.reason = "busy";
      this.store.putAutomationRun(run);
      return;
    }
    try {
      const folder = await stat(automation.cwd).catch(() => undefined);
      if (!folder?.isDirectory()) {
        run.launchError = run.issue
          ? "Could not start the agent for this issue. Remove the label and add it again."
          : "Could not open the automation folder. Edit the folder and run again.";
      } else {
        run.startedAt = Date.now();
        this.store.putAutomationRun(run);
        const directory = join(this.root, "automation-files", automation.id);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const instructionFile = join(directory, `${randomUUID()}.md`);
        await writeFile(
          instructionFile,
          received
            ? webhookInstruction(automation.instruction, received)
            : run.issue
              ? `${automation.instruction}\n\nWork on issue #${run.issue.number}. Read its body and comments with ` +
                "`iori issue show " +
                run.issue.number +
                "`" +
                `. When the change is ready, commit it and create a draft pull request with ` +
                "`iori pr create --issue " +
                run.issue.number +
                ' --title "<a short title>"`' +
                "."
              : automation.instruction,
          {
            mode: 0o600,
          },
        );
        const setup = setupWorktree
          ? await worktreeSetup(automation.cwd, this.store)
          : undefined;
        const context = { clientPublicKey: "automation", operationId: run.id };
        const result: Response<TerminalCreatedResult> =
          automation.target.kind === "team"
            ? await this.teams().launch(
                context,
                automation.target.teamId,
                automation.cwd,
                setup,
                instructionFile,
              )
            : await this.terminals().createTerminal(
                context,
                automation.cwd,
                undefined,
                automation.target.candidate.cli,
                undefined,
                setup,
                {
                  candidate: automation.target.candidate,
                  instructionFile,
                },
              );
        if (result.ok) run.terminalId = result.result.terminal.id;
        else {
          const team =
            automation.target.kind === "team"
              ? this.store.readTeam(automation.target.teamId)?.saved
              : undefined;
          run.launchError =
            team && !team.parent.cli
              ? "This team has no parent CLI. Edit the team and choose one."
              : run.issue
                ? "Could not start the agent for this issue. Remove the label and add it again."
                : "Could not start the agent. Edit the automation and run again.";
        }
      }
    } catch {
      // A lost launch response does not prove that the CLI failed to start.
      // Keep the claimed occurrence and never retry its side effect.
      console.error("Automation launch response was interrupted");
    }
    this.store.putAutomationRun(run);
  }
}
