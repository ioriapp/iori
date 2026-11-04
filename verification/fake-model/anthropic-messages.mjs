import { randomUUID } from "node:crypto";

// https://platform.claude.com/docs/en/build-with-claude/streaming
export function anthropicMessages(response, body, step) {
  const tool = step.tool !== undefined;
  // Scenario input includes cache reads, as iori's total input does.
  // Messages reports the uncached part and cache reads separately.
  const input = step.usage?.input ?? 10;
  const output = step.usage?.output ?? 10;
  const usage = {
    input_tokens: input - (step.usage?.cache ?? 0),
    output_tokens: output,
    ...(step.usage?.cache === undefined
      ? {}
      : { cache_read_input_tokens: step.usage.cache }),
    ...(step.usage?.reasoning === undefined
      ? {}
      : { output_tokens_details: { thinking_tokens: step.usage.reasoning } }),
  };
  const block = tool
    ? {
        type: "tool_use",
        id: `toolu_${randomUUID()}`,
        name: step.tool,
        input: step.input,
      }
    : { type: "text", text: step.text };
  const message = {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: body.model,
    content: [block],
    stop_reason: tool ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage,
  };
  if (!body.stream) {
    if (step.hold) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.flushHeaders();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const event = (type, data) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
    );
  event("message_start", {
    message: {
      ...message,
      content: [],
      stop_reason: null,
      usage: {
        ...usage,
        output_tokens: 0,
        ...(step.usage?.reasoning === undefined
          ? {}
          : { output_tokens_details: { thinking_tokens: 0 } }),
      },
    },
  });
  if (step.hold) return;
  event("content_block_start", {
    index: 0,
    content_block: tool ? { ...block, input: {} } : { type: "text", text: "" },
  });
  event("content_block_delta", {
    index: 0,
    delta: tool
      ? { type: "input_json_delta", partial_json: JSON.stringify(step.input) }
      : { type: "text_delta", text: step.text },
  });
  event("content_block_stop", { index: 0 });
  event("message_delta", {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: {
      output_tokens: output,
      ...(usage.output_tokens_details
        ? { output_tokens_details: usage.output_tokens_details }
        : {}),
    },
  });
  event("message_stop", {});
  response.end();
}
