import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { registerScriptedCli } from "../../verification/host/scripted-definition.mjs";
import { contracts, launchTeam, scriptedChildStarted } from "./contracts.mjs";
import { commandStep, marker, unattendedClaude, withCli } from "./fixture.mjs";

contracts("claude");

// A denied detour must continue to delegation without waiting for approval.
test("本物のモデル用の承認設定で拒否の後も委譲した子が起動する", (t) =>
  withCli(
    t,
    "claude",
    {
      delegate: [
        commandStep(
          "claude",
          `node -e "require('fs').writeFileSync('unexpected-approval', 'ran')"`,
        ),
        commandStep(
          "claude",
          'iori delegate --role Worker --difficulty medium --title "Delegated task" --worktree parent --body "Confirm receipt."',
        ),
        { text: "COMPAT_DELEGATED", delayMs: 0 },
      ],
    },
    async (context) => {
      await unattendedClaude(join(context.dataRoot, "cli-home"));
      const childCli = await registerScriptedCli(
        context.client,
        context.dataRoot,
      );
      const { created, events } = await launchTeam(
        context,
        "claude",
        childCli,
        marker("delegate"),
      );
      await context.terminal(context.client, created.id);
      context.stage("承認が必要なコマンドの拒否後に委譲した子の起動を確認する");
      await scriptedChildStarted(context, events, created.id);
      await assert.rejects(
        readFile(join(context.dataRoot, "repository/unexpected-approval")),
        { code: "ENOENT" },
      );
    },
    { team: true },
  ));
