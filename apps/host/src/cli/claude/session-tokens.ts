import { object } from "../hooks.ts";
import { sessionTokenReader, tokenNumber } from "../session-tokens.ts";
import type { TokenUsage } from "@iori/protocol";
function claudeMessageUsage(
  record: Record<string, unknown>,
): { id: string; usage: TokenUsage } | undefined {
  if (record.type !== "assistant") return undefined;
  const message = object(record.message),
    usage = object(message.usage);
  const input = tokenNumber(usage.input_tokens),
    output = tokenNumber(usage.output_tokens);
  if (
    typeof message.id !== "string" ||
    input === undefined ||
    output === undefined
  )
    return undefined;
  const cacheRead = tokenNumber(usage.cache_read_input_tokens),
    cacheWrite = tokenNumber(usage.cache_creation_input_tokens);
  const reasoning = tokenNumber(
    object(usage.output_tokens_details).thinking_tokens,
  );
  return {
    id: message.id,
    usage: {
      input: input + (cacheRead ?? 0) + (cacheWrite ?? 0),
      output,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(cacheRead === undefined ? {} : { cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
    },
  };
}
export const sessionTokens = sessionTokenReader(claudeMessageUsage);
