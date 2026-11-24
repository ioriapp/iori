import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TerminalSummary, Worktree } from "@iori/protocol";
import { resolveAgentTargets } from "./agent-targets.ts";

function makeTerminal(
  overrides: Partial<TerminalSummary> & { id: string; cwd: string },
): TerminalSummary {
  return {
    shell: "bash",
    title: "bash",
    cols: 80,
    rows: 24,
    lastDesktopSize: { cols: 80, rows: 24 },
    createdAt: 1,
    worktreePath: overrides.cwd,
    ...overrides,
  };
}

const repoWorktrees: Worktree[] = [
  { path: "/repo", branch: "main", primary: true, detached: false },
  { path: "/repo-wt-1", branch: "feat-a", primary: false, detached: false },
  { path: "/repo-wt-2", branch: "feat-b", primary: false, detached: false },
];

describe("resolveAgentTargets", () => {
  it("excludes Team child terminals and prefers the Team parent in the current worktree", () => {
    const targets = resolveAgentTargets({
      selectedCwd: "/repo-wt-1",
      workspacePath: "/repo",
      repoWorktrees,
      childTerminalIds: new Set(["child-2"]),
      terminals: [
        makeTerminal({
          id: "child-1",
          cwd: "/repo-wt-1",
          teamChild: "c1",
          cli: { id: "codex", name: "Codex" },
        }),
        makeTerminal({
          id: "child-2",
          cwd: "/repo-wt-1",
          cli: { id: "claude", name: "Claude" },
        }),
        makeTerminal({
          id: "parent-1",
          cwd: "/repo-wt-1",
          teamConversation: "conv-1",
          cli: { id: "claude", name: "Claude" },
        }),
        makeTerminal({
          id: "shell-1",
          cwd: "/repo-wt-1",
        }),
      ],
    });
    assert.deepEqual(
      targets.map((t) => ({ id: t.terminalId, isTeamParent: t.isTeamParent })),
      [{ id: "parent-1", isTeamParent: true }],
    );
  });

  it("never falls back to a Team child when no parent or standalone CLI exists", () => {
    const targets = resolveAgentTargets({
      selectedCwd: "/repo-wt-1",
      workspacePath: "/repo",
      repoWorktrees,
      childTerminalIds: new Set(["child-1"]),
      terminals: [
        makeTerminal({
          id: "child-1",
          cwd: "/repo-wt-1",
          teamChild: "c1",
          cli: { id: "codex", name: "Codex" },
        }),
      ],
    });
    assert.deepEqual(targets, []);
  });

  it("falls back to another worktree's Team parent in the same repo when viewing main CI", () => {
    const targets = resolveAgentTargets({
      selectedCwd: "/repo",
      workspacePath: "/repo",
      repoWorktrees,
      childTerminalIds: new Set(),
      terminals: [
        makeTerminal({
          id: "parent-wt1",
          cwd: "/repo-wt-1",
          teamConversation: "conv-1",
          cli: { id: "claude", name: "Claude" },
        }),
        makeTerminal({
          id: "other-repo",
          cwd: "/unrelated-repo",
          teamConversation: "conv-2",
          cli: { id: "claude", name: "Claude" },
        }),
      ],
    });
    assert.deepEqual(
      targets.map((t) => ({ id: t.terminalId, label: t.label })),
      [{ id: "parent-wt1", label: "feat-a" }],
    );
  });

  it("returns multiple same-repo worktree Team parents so the user can choose", () => {
    const targets = resolveAgentTargets({
      selectedCwd: "/repo",
      workspacePath: "/repo",
      repoWorktrees,
      childTerminalIds: new Set(),
      terminals: [
        makeTerminal({
          id: "parent-wt1",
          cwd: "/repo-wt-1",
          teamConversation: "conv-1",
          cli: { id: "claude", name: "Claude" },
        }),
        makeTerminal({
          id: "parent-wt2",
          cwd: "/repo-wt-2",
          teamConversation: "conv-2",
          cli: { id: "codex", name: "Codex" },
        }),
      ],
    });
    assert.deepEqual(
      targets.map((t) => t.terminalId),
      ["parent-wt1", "parent-wt2"],
    );
  });

  it("excludes exited/errored terminals and picks a single preferred CLI in the current worktree", () => {
    const targets = resolveAgentTargets({
      selectedCwd: "/repo-wt-1",
      workspacePath: "/repo",
      repoWorktrees,
      childTerminalIds: new Set(),
      lastTerminalId: "cli-1",
      terminals: [
        makeTerminal({
          id: "dead-parent",
          cwd: "/repo-wt-1",
          teamConversation: "conv-dead",
          state: "exited",
          cli: { id: "claude", name: "Claude" },
        }),
        makeTerminal({
          id: "cli-1",
          cwd: "/repo-wt-1",
          cli: { id: "claude", name: "Claude" },
        }),
        makeTerminal({
          id: "cli-2",
          cwd: "/repo-wt-1",
          cli: { id: "codex", name: "Codex" },
        }),
      ],
    });
    assert.deepEqual(
      targets.map((t) => t.terminalId),
      ["cli-1"],
    );
  });
});
