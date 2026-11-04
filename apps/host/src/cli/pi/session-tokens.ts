import { object } from "../hooks.ts";
import { sessionTokenReader, tokenNumber } from "../session-tokens.ts";
import type { TokenUsage } from "@iori/protocol";
function piMessageUsage(
  record: Record<string, unknown>,
): { id: string; usage: TokenUsage } | undefined {
  const message = object(record.message),
    usage = object(message.usage);
  if (
    record.type !== "message" ||
    message.role !== "assistant" ||
    typeof record.id !== "string"
  )
    return undefined;
  const input = tokenNumber(usage.input),
    output = tokenNumber(usage.output);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = tokenNumber(usage.cacheRead),
    cacheWrite = tokenNumber(usage.cacheWrite);
  const reasoning = tokenNumber(usage.reasoning);
  return {
    id: record.id,
    usage: {
      input: input + (cacheRead ?? 0) + (cacheWrite ?? 0),
      output,
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(cacheRead === undefined ? {} : { cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWrite }),
    },
  };
}
export const sessionTokens = sessionTokenReader(piMessageUsage);
