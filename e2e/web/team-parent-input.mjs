import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { teamNotice } from "../../packages/protocol/src/team-text.ts";
import {
  waitForOperation,
  cliFailure,
} from "../../verification/web/operation.mjs";
import { waitForCliState } from "../cli-screen/scenario.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import { pasteToCli } from "./cli-input.mjs";

// --tools affects built-ins only; prepareCliHome denies MCP tools for every CLI home.
export const claudeWithoutTools = '--tools ""';

// Only real CLI gestures use this gate. iori commands execute directly through
// the parent's route; /exit waits for Host delivery and an idle input prompt.
export function teamParentInput({
  client,
  parentId,
  teamRecords,
  teamDelivery,
}) {
  const acknowledged = new Set();
  const settle = async () => {
    await waitForOperation(
      "team-parent-input: 子の応答と通知を受けた親の応答完了",
      async () => {
        const records = await teamRecords();
        for (const child of records.children) {
          if (child.state === "waiting" && !child.waiting) return false;
          if (child.parentNoticePending) return false;
          if (["stopped", "finished"].includes(child.state)) continue;
          const cli = records.terminals.find(
            (entry) => entry.id === child.terminalId,
          );
          let event;
          let since;
          let line;
          if (child.state === "waiting") {
            if (child.waiting !== "candidates" || !child.notified) continue;
            event = "no available candidate";
            since = child.createdAt;
            line =
              "[iori] No available candidate for this delegation. Edit the team, then run iori tasks.";
          } else if (child.state === "failed") {
            event = "failed";
            since = Math.max(child.createdAt, child.startedAt ?? 0);
          } else if (cli?.value.runtime?.status?.state === "waiting") {
            continue;
          } else if (["pending", "active"].includes(child.parentResponse)) {
            return false;
          } else if (child.parentResponse === "unreported") {
            event = "is idle without a report or question";
            since = Math.max(
              child.createdAt,
              ...(await Promise.all(
                (child.messageFiles ?? []).map(
                  async (file) => (await stat(file)).mtimeMs,
                ),
              )),
            );
          } else if (child.state === "reported") {
            event = "reported";
            since = child.reportedAt;
          } else if (child.state === "question") {
            event = "asked a question";
            since = child.questionedAt;
          }
          if (event) {
            const key = `${child.id}:${event}:${since}`;
            if (acknowledged.has(key)) continue;
            const delivery = await teamDelivery({
              line:
                line ??
                teamNotice(
                  child.role?.name ?? child.roleName,
                  child.title,
                  event,
                  child.failure,
                  child.cliError ? child.task : undefined,
                ),
              since,
            });
            if (!delivery.claude.noticeReceived) return false;
            acknowledged.add(key);
          }
        }
        return (await teamDelivery()).claude.pendingNotices === 0;
      },
      Boolean,
      cliFailure(client.screen, parentId),
    );
    await waitForCliState(client, parentId, ["idle", "done"]);
  };
  return {
    settle,
    async submit(text) {
      await settle();
      await submitToCli(client, text, undefined, "team-parent-input");
    },
    async resumeWithoutTools() {
      const screen = client.screen;
      const request = (method, params) =>
        screen.evaluate(
          `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r.ok)throw new Error('親CLIの起動設定を変更できません');return r.result;})()`,
        );
      const before = (await teamRecords()).terminals.find(
        (entry) => entry.id === parentId,
      ).value.session.id;
      const settings = await request("cli.list", {});
      const original =
        settings.clis.find((entry) => entry.id === "claude").startupArguments ??
        "";
      await request("cli.arguments.set", {
        cliId: "claude",
        arguments: `${original} ${claudeWithoutTools}`.trim(),
      });
      try {
        await screen.click(`[data-iori-terminal-row="${parentId}"]`);
        await screen.wait('[data-iori-action="cli-resume"]');
        await screen.click('[data-iori-action="cli-resume"]');
        await waitForCliState(client, parentId, ["idle", "done"]);
        const resumed = (await teamRecords()).terminals.find(
          (entry) => entry.id === parentId,
        ).value;
        assert.equal(resumed.session.id, before, "同じ親CLIの会話を再開する");
        assert.ok(
          resumed.command.includes(claudeWithoutTools),
          "親は道具なしで再開する",
        );
      } finally {
        // The next real Claude child must retain its normal tools. Already
        // running parents keep the arguments used for their own launch.
        await request("cli.arguments.set", {
          cliId: "claude",
          arguments: original,
        });
      }
    },
    async paste(text) {
      await settle();
      await pasteToCli(client, text);
    },
  };
}
