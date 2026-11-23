import { readFile } from "node:fs/promises";
import {
  creationOrder,
  definitionOrder,
  roleOrder,
  type BoardAgent,
  type BoardData,
  type BoardSummary,
  type ChildSummary,
  type RecordsData,
  type RecordsFilter,
  type TaskHistoryData,
  type TaskRecord,
} from "@iori/protocol";
import { cliDefinitions, withCurrentCliIcon } from "../cli/definitions.ts";
import type { HostStore } from "../store.ts";
import type { TerminalManager } from "../terminal/manager.ts";
import type { TeamChild, TeamConversation, TeamTask } from "./records.ts";

interface TeamQuerySource {
  store: HostStore;
  terminals: TerminalManager;
  conversations: ReadonlyMap<string, TeamConversation>;
  children: ReadonlyMap<string, TeamChild>;
  tasks: ReadonlyMap<string, TeamTask>;
  conversationChildren: ReadonlyMap<string, ReadonlySet<string>>;
  workStarted: ReadonlyMap<string, number>;
  replyState(child: TeamChild): ChildSummary["state"];
}

export class TeamQueries {
  readonly #source: TeamQuerySource;
  constructor(source: TeamQuerySource) {
    this.#source = source;
  }
  childSummary(
    child: TeamChild,
    teams: Map<string, ReturnType<HostStore["readTeam"]>>,
  ): ChildSummary {
    const { store, terminals, conversations, replyState } = this.#source;
    const parent = conversations.get(child.conversation)!;
    const terminal = child.terminalId
      ? terminals.summary(child.terminalId)
      : undefined;
    const cli =
      terminal?.cli ??
      (child.terminalId ? store.terminalCli(child.terminalId)?.cli : undefined);
    if (!child.role?.name && !teams.has(parent.teamId))
      teams.set(parent.teamId, store.readTeam(parent.teamId));
    return {
      id: child.id,
      createdAt: child.createdAt,
      conversation: child.conversation,
      parentTerminalId: parent.terminalId,
      parentCwd: parent.cwd,
      teamId: parent.teamId,
      role:
        child.role?.name ??
        teams.get(parent.teamId)?.saved.roles.find((r) => r.id === child.roleId)
          ?.name ??
        child.roleName,
      title: child.title,
      terminalId: child.terminalId,
      cwd: child.cwd,
      createdWorktree:
        child.cwd !== undefined
          ? child.createdWorktree === child.cwd
          : undefined,
      worktreeRemoved: child.worktreeRemoved,
      repositoryName: child.repository?.external
        ? child.repository.name
        : undefined,
      branch: child.branch,
      cli: cli ? withCurrentCliIcon(cli) : undefined,
      model: child.candidate?.model,
      cliStatus: terminal?.cliStatus,
      state: replyState(child),
      waiting: child.waiting,
      stoppedBy: child.stoppedBy,
      decision: child.decision,
      reason: child.reason,
      failure: child.failure,
      startedAt: child.startedAt,
      elapsedMs: child.elapsedMs,
      notified: child.notified,
    };
  }
  boards(): { boards: BoardSummary[] } {
    const {
      store,
      terminals,
      conversations,
      conversationChildren,
      children,
      replyState,
    } = this.#source;
    const groups = new Map<
      string,
      {
        summary: BoardSummary;
        parentActivity: number;
        createdAt: number;
      }
    >();
    for (const conversation of conversations.values()) {
      const terminal = store.terminalSummary(conversation.terminalId);
      if (!terminal) continue;
      const parentActivity = conversation.lastActiveAt ?? 0;
      const parentStatus = terminals.summary(
        conversation.terminalId,
      )?.cliStatus;
      const lastActivityAt = Math.max(
        terminal.createdAt,
        parentActivity,
        parentStatus?.since ?? 0,
      );
      let group = groups.get(conversation.cwd);
      if (!group) {
        group = {
          summary: {
            createdAt: terminal.createdAt,
            cwd: conversation.cwd,
            conversation: conversation.id,
            terminalId: conversation.terminalId,
            hasActive: parentStatus?.state === "active",
            lastActivityAt,
            children: [],
          },
          parentActivity,
          createdAt: terminal.createdAt,
        };
        groups.set(conversation.cwd, group);
      } else {
        group.summary.createdAt = Math.min(
          group.summary.createdAt,
          terminal.createdAt,
        );
        group.summary.hasActive ||= parentStatus?.state === "active";
        group.summary.lastActivityAt = Math.max(
          group.summary.lastActivityAt,
          lastActivityAt,
        );
        if (
          parentActivity > group.parentActivity ||
          (parentActivity === group.parentActivity &&
            terminal.createdAt > group.createdAt)
        ) {
          group.summary.conversation = conversation.id;
          group.summary.terminalId = conversation.terminalId;
          group.parentActivity = parentActivity;
          group.createdAt = terminal.createdAt;
        }
      }
      for (const id of conversationChildren.get(conversation.id) ?? []) {
        const child = children.get(id)!;
        const cliStatus = child.terminalId
          ? terminals.summary(child.terminalId)?.cliStatus
          : undefined;
        group.summary.hasActive ||= cliStatus?.state === "active";
        group.summary.children.push({
          state: replyState(child),
          cliStatus,
          waiting: child.waiting,
          stoppedBy: child.stoppedBy,
        });
        group.summary.lastActivityAt = Math.max(
          group.summary.lastActivityAt,
          child.createdAt,
          child.startedAt ?? 0,
          child.reportedAt ?? 0,
          child.questionedAt ?? 0,
          child.endedAt ?? 0,
          child.decidedAt ?? 0,
          cliStatus?.since ?? 0,
        );
      }
    }
    return { boards: [...groups.values()].map(({ summary }) => summary) };
  }
  async board(
    cwd: string,
    measure: (children: TeamChild[]) => Promise<void>,
  ): Promise<BoardData> {
    const { store, terminals, tasks } = this.#source;
    const conversations = [...this.#source.conversations.values()]
      .flatMap((conversation) => {
        const terminal = store.terminalSummary(conversation.terminalId);
        return conversation.cwd === cwd && terminal
          ? [
              {
                ...conversation,
                createdAt: terminal.createdAt,
                title: terminal.title,
              },
            ]
          : [];
      })
      .sort(creationOrder);
    const ids = new Set(conversations.map((conversation) => conversation.id));
    const children = [...this.#source.children.values()].filter((child) =>
      ids.has(child.conversation),
    );
    const active = children.filter((child) =>
      terminals.isCliRunning(child.terminalId ?? ""),
    );
    await measure(active);
    const teams = new Map<string, ReturnType<HostStore["readTeam"]>>();
    const agents: BoardAgent[] = children.map((child) => ({
      ...this.childSummary(child, teams),
      roleId: child.roleId,
      difficulty: (
        child.role ??
        teams
          .get(this.#source.conversations.get(child.conversation)!.teamId)
          ?.saved.roles.find((role) => role.id === child.roleId)
      )?.split
        ? child.difficulty
        : undefined,
      task: child.task,
      plan: tasks.get(child.task)?.plan,
      createdAt: child.createdAt,
      firstStartedAt: child.firstStartedAt,
      endedAt: child.endedAt,
      reportedAt: child.reportedAt,
      questionedAt: child.questionedAt,
      changes: child.changes,
      tokens: child.tokens,
      effort: child.candidate?.effort,
      revisions: tasks.get(child.task)?.revisions.length ?? 0,
      waitingReasons: child.waitingReasons,
    }));
    const running = terminals.runningClis();
    const compareClis = definitionOrder(cliDefinitions.map((cli) => cli.id));
    return {
      defaultConversation:
        conversations
          .filter((entry) => entry.lastActiveAt !== undefined)
          .sort((a, b) => b.lastActiveAt! - a.lastActiveAt!)[0]?.id ??
        conversations.at(-1)?.id,
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        terminalId: conversation.terminalId,
        teamId: conversation.teamId,
        name:
          conversation.title ??
          store.readTeam(conversation.teamId)?.saved.name ??
          conversation.teamName,
        createdAt: conversation.createdAt,
        lastActiveAt: conversation.lastActiveAt,
        plan: conversation.plan,
      })),
      agents,
      roles: conversations.flatMap((conversation) =>
        (store.readTeam(conversation.teamId)?.saved.roles ?? []).map(
          (role) => ({
            conversation: conversation.id,
            name: role.name,
            limit: role.limit,
            used: running.filter(
              (cli) =>
                cli.conversation === conversation.id && cli.role === role.id,
            ).length,
            waiting: children.filter(
              (child) =>
                child.conversation === conversation.id &&
                child.roleId === role.id &&
                child.state === "waiting" &&
                child.waiting === "capacity",
            ).length,
          }),
        ),
      ),
      usage: [...terminals.cliUsage()]
        .sort(([a], [b]) => compareClis(a, b))
        .filter(([cli]) =>
          children.some((child) => child.candidate?.cli === cli),
        )
        .map(([cli, usage]) => ({
          cli,
          name:
            cliDefinitions.find((definition) => definition.id === cli)?.name ??
            cli,
          usage,
        })),
    };
  }
  records(filter: RecordsFilter): RecordsData {
    const { store, workStarted } = this.#source;
    const now = Date.now();
    const childrenByTask = Map.groupBy(
      this.#source.children.values(),
      (child) => child.task,
    );
    for (const children of childrenByTask.values())
      children.sort((a, b) => a.createdAt - b.createdAt);
    const tasks: TaskRecord[] = [...this.#source.tasks.values()].flatMap(
      (task) => {
        const children = childrenByTask.get(task.id) ?? [];
        const first = children[0];
        if (!first) return [];
        const conversation = this.#source.conversations.get(task.conversation)!;
        const last =
          this.#source.children.get(task.currentChild ?? "") ??
          children.at(-1)!;
        return [
          {
            id: task.id,
            conversation: task.conversation,
            parentTerminalId: store.terminal(conversation.terminalId)
              ? conversation.terminalId
              : undefined,
            title: first.title,
            teamId: conversation.teamId,
            team:
              store.readTeam(conversation.teamId)?.saved.name ??
              conversation.teamName,
            version: first.teamVersion ?? conversation.teamVersion,
            role: first.role?.name ?? first.roleName,
            difficulty: first.difficulty,
            plan: task.plan,
            createdAt: first.createdAt,
            decision: task.decision,
            reason: task.reason,
            decidedAt: task.decidedAt,
            revisions: task.revisions.length,
            elapsedMs: task.elapsedMs,
            changes: task.changes ?? last.changes,
            agents: children.map((child) => ({
              id: child.id,
              role: child.role?.name ?? child.roleName,
              candidate: child.candidate
                ? {
                    ...child.candidate,
                    cliName: child.terminalId
                      ? store.terminalCli(child.terminalId)?.cli.name
                      : undefined,
                  }
                : undefined,
              createdAt: child.createdAt,
              startedAt: child.firstStartedAt,
              endedAt: child.endedAt,
              elapsedMs: child.elapsedMs,
              workMs:
                child.firstStartedAt === undefined || child.workMs === undefined
                  ? undefined
                  : child.workMs +
                    Math.max(0, now - (workStarted.get(child.id) ?? now)),
              tokens: child.tokens,
              changes: child.changes,
              terminalId: child.terminalId,
              revisions: task.revisions.filter(
                (revision) => revision.child === child.id,
              ).length,
              teamVersion: child.teamVersion,
            })),
          },
        ];
      },
    );
    const teams = new Map<
      string,
      { id: string; name?: string; versions: number[] }
    >();
    for (const task of tasks) {
      let team = teams.get(task.teamId);
      if (!team) {
        team = { id: task.teamId, name: task.team, versions: [] };
        teams.set(team.id, team);
      }
      if (!team.versions.includes(task.version))
        team.versions.push(task.version);
    }
    return {
      roleNames: roleOrder(
        store
          .listTeams()
          .teams.filter(
            (team) => !filter.teamId || team.saved.id === filter.teamId,
          )
          .map((team) => team.saved),
      ),
      tasks: tasks.filter(
        (task) =>
          (filter.days === undefined ||
            task.createdAt >= Date.now() - filter.days * 86400000) &&
          (filter.startAt === undefined || task.createdAt >= filter.startAt) &&
          (filter.endAt === undefined || task.createdAt <= filter.endAt) &&
          (filter.teamId === undefined || task.teamId === filter.teamId) &&
          (filter.version === undefined || task.version === filter.version) &&
          (filter.difficulty === undefined ||
            task.difficulty === filter.difficulty),
      ),
      teams: [...teams.values()]
        .sort(
          (a, b) =>
            (a.name ?? "").localeCompare(b.name ?? "") ||
            a.id.localeCompare(b.id),
        )
        .map((team) => ({
          ...team,
          versions: team.versions.sort((a, b) => b - a),
        })),
    };
  }
  async taskHistory(id: string): Promise<TaskHistoryData> {
    const { store, conversations, tasks } = this.#source;
    const task = tasks.get(id);
    if (!task) return { events: [] };
    const children = [...this.#source.children.values()]
      .filter((child) => child.task === id)
      .sort((a, b) => a.createdAt - b.createdAt);
    const events: TaskHistoryData["events"] = children.flatMap(
      (child, index) => [
        {
          at: child.createdAt,
          kind: index ? ("Handoff" as const) : ("Delegated" as const),
          child: child.id,
          role: child.role?.name ?? child.roleName,
          candidate: child.candidate,
          difficulty: child.difficulty,
        },
        ...(child.decision && child.decidedAt !== undefined
          ? [
              {
                at: child.decidedAt,
                kind:
                  child.decision === "accept"
                    ? ("Accepted" as const)
                    : ("Rejected" as const),
                child: child.id,
                candidate: child.candidate,
                body: child.reason,
              },
            ]
          : []),
        ...(child.inputs ?? []).map((entry) => ({
          at: entry.at,
          kind: "Input" as const,
          child: child.id,
          candidate: child.candidate,
          body: entry.body,
        })),
      ],
    );
    for (const revision of task.revisions) {
      let body: string | undefined;
      if (revision.file)
        try {
          body = await readFile(revision.file, "utf8");
        } catch {
          /* A missing body is absent, not an error. */
        }
      events.push({
        at: revision.at,
        kind: "Revise",
        child: revision.child,
        candidate: revision.candidate,
        body,
      });
    }
    events.sort((a, b) => a.at - b.at);
    const parent = conversations.get(task.conversation)!.terminalId;
    const last = children.at(-1);
    return {
      events,
      childTerminalId:
        last?.terminalId && store.terminalSummary(last.terminalId)
          ? last.terminalId
          : undefined,
      parentTerminalId: store.terminal(parent) ? parent : undefined,
    };
  }
}
