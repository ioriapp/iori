import test from "node:test";
import { registerScriptedCli } from "../../verification/host/scripted-definition.mjs";
import { launchTeam, scriptedChildStarted, teamChild } from "./contracts.mjs";
import { withCli } from "./fixture.mjs";

const options = { skip: process.env.IORI_CLI_COMPAT_REAL_MODEL !== "1" };

test("子が最初の依頼を受信して報告が親へ届く", options, (t) =>
  withCli(
    t,
    "claude",
    {},
    async (context) => {
      context.stage("Claude Codeの子へ最初の報告の依頼を送る");
      const child = await teamChild(
        context,
        "claude",
        undefined,
        "Report the text COMPAT_REPORT to your parent using iori report.",
      );
      context.stage("Hostが子の報告を受け取り親へ届ける");
      await child.events.waitFor(
        (event) =>
          event.type === "teams.child.updated" &&
          event.child.id === child.childId &&
          event.child.state === "reported",
      );
      await child.parent.output('\\"Compatibility\\" reported.');
    },
    { team: true, realModel: true },
  ),
);

test("親が入力を受信して委譲した子が起動する", options, (t) =>
  withCli(
    t,
    "claude",
    {},
    async (context) => {
      const childCli = await registerScriptedCli(
        context.client,
        context.dataRoot,
      );
      context.stage("Claude Codeの親へWorkerへの委譲を依頼する");
      const { created, events } = await launchTeam(
        context,
        "claude",
        childCli,
        "Delegate to Worker using the parent worktree. The task is to report that delegation was received.",
      );
      await context.terminal(context.client, created.id);
      context.stage("Hostが親の委譲を受け取り台本のCLIの子を起動する");
      await scriptedChildStarted(context, events, created.id);
    },
    { team: true, realModel: true },
  ),
);
