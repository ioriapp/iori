import type { ModelAdapter } from "../models.ts";
import { modelDialogue, ModelCommandError } from "../models.ts";
/** The Agent SDK supportedModels() reads the models in its initialize response.
 * Use that published control schema with the installed CLI through our shell. */
export const models: ModelAdapter = async (shell, command, signal) => {
  let found: import("@iori/protocol").CliModel[] | undefined;
  const result = await modelDialogue(
    shell,
    command +
      " --print --input-format stream-json --output-format stream-json --verbose --no-session-persistence --safe-mode --strict-mcp-config",
    signal,
    {
      type: "control_request",
      request_id: "iori-models",
      request: { subtype: "initialize" },
    },
    (value, _send, end) => {
      if (value.type !== "control_response") return;
      const envelope = value.response as {
        request_id: string;
        subtype: string;
        response?: {
          models: {
            value: string;
            displayName: string;
            supportedEffortLevels?: string[];
          }[];
        };
      };
      if (envelope.request_id !== "iori-models") return;
      if (envelope.subtype !== "success" || !envelope.response?.models) {
        end();
        throw new Error("invalid_output");
      }
      found = envelope.response.models.map((m) => ({
        name: m.value,
        label: m.displayName,
        efforts: m.supportedEffortLevels ?? [],
      }));
      end();
    },
    true,
  );
  if (!found) throw new ModelCommandError(result.stderr || result.output);
  return {
    models: found,
    permissions: [
      {
        key: "permission",
        label: "permission mode",
        options: [
          "default",
          "acceptEdits",
          "auto",
          "plan",
          "bypassPermissions",
          "dontAsk",
        ],
      },
    ],
  };
};
