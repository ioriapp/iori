import type { ModelAdapter } from "../models.ts";
import { modelDialogue, ModelCommandError } from "../models.ts";
export const models: ModelAdapter = async (shell, command, signal) => {
  const found: import("@iori/protocol").CliModel[] = [];
  let complete = false;
  const result = await modelDialogue(
    shell,
    command + " app-server",
    signal,
    {
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "iori", version: "1" } },
    },
    (value, send, end) => {
      if (value.error) {
        end();
        throw new Error("command_failed");
      }
      if (value.id === 1) {
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "model/list", params: {} });
      }
      if (value.id === 2) {
        const result = value.result as {
          data: {
            model: string;
            displayName?: string;
            supportedReasoningEfforts: { reasoningEffort: string }[];
          }[];
          nextCursor?: string;
        };
        found.push(
          ...result.data.map((m) => ({
            name: m.model,
            label: m.displayName,
            efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort),
          })),
        );
        if (result.nextCursor)
          send({
            id: 2,
            method: "model/list",
            params: { cursor: result.nextCursor },
          });
        else {
          complete = true;
          end();
        }
      }
    },
    true,
  );
  if (!complete) throw new ModelCommandError(result.stderr || result.output);
  return {
    models: found,
    permissions: [
      {
        key: "permission",
        label: "approval_policy",
        options: ["on-request", "never", "untrusted", "on-failure"],
      },
      {
        key: "sandbox",
        label: "sandbox_mode",
        options: ["read-only", "workspace-write", "danger-full-access"],
      },
    ],
  };
};
