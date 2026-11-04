import { object } from "../hooks.ts";
import { sessionTokenReader, tokenNumber } from "../session-tokens.ts";
import type { TokenUsage } from "@iori/protocol";
function codexRecordUsage(
  record: Record<string, unknown>,
): TokenUsage | undefined {
  const payload = object(record.payload);
  if (record.type !== "event_msg" || payload.type !== "token_count")
    return undefined;
  const usage = object(object(payload.info).total_token_usage);
  const input = tokenNumber(usage.input_tokens),
    output = tokenNumber(usage.output_tokens);
  if (input === undefined || output === undefined) return undefined;
  const cacheRead = tokenNumber(usage.cached_input_tokens),
    reasoning = tokenNumber(usage.reasoning_output_tokens);
  const cacheWrite = tokenNumber(usage.cache_write_input_tokens);
  return {
    input,
    output,
    ...(cacheWrite === undefined ? {} : { cacheWrite }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}
export const sessionTokens = sessionTokenReader((record) => {
  const usage = codexRecordUsage(record);
  return usage ? { usage } : undefined;
});
