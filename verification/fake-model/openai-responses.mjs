import { randomUUID } from "node:crypto";

// https://developers.openai.com/api/reference/resources/responses/streaming-events
export function openaiResponses(response, body, step) {
  const tool = step.tool !== undefined;
  const input = step.usage?.input ?? 10;
  const outputTokens = step.usage?.output ?? 10;
  // Freeform tools take a literal string; function tools take JSON arguments.
  const custom = tool && typeof step.input === "string";
  const output = [];
  if (step.text !== undefined)
    output.push({
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      phase: tool ? "commentary" : "final_answer",
      status: "completed",
      content: [{ type: "output_text", text: step.text, annotations: [] }],
    });
  if (tool)
    output.push({
      id: `fc_${randomUUID()}`,
      type: custom ? "custom_tool_call" : "function_call",
      call_id: `call_${randomUUID()}`,
      name: step.tool,
      ...(custom
        ? { input: step.input }
        : { arguments: JSON.stringify(step.input) }),
      status: "completed",
    });
  const result = {
    id: `resp_${randomUUID()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: body.model,
    output,
    usage: {
      input_tokens: input,
      output_tokens: outputTokens,
      total_tokens: input + outputTokens,
      input_tokens_details: { cached_tokens: step.usage?.cache ?? 0 },
      output_tokens_details: { reasoning_tokens: step.usage?.reasoning ?? 0 },
    },
  };
  if (!body.stream) {
    response.writeHead(200, { "Content-Type": "application/json" });
    if (!step.hold) response.end(JSON.stringify(result));
    else response.flushHeaders();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  let sequence = 0;
  const event = (type, data) =>
    response.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
    );
  event("response.created", {
    response: { ...result, status: "in_progress", output: [] },
  });
  if (step.hold) return;
  for (const [output_index, item] of output.entries()) {
    const tool = item.type !== "message";
    event("response.output_item.added", {
      output_index,
      item: {
        ...item,
        status: "in_progress",
        ...(tool
          ? custom
            ? { input: "" }
            : { arguments: "" }
          : { content: [] }),
      },
    });
    if (tool) {
      const prefix = custom
        ? "response.custom_tool_call_input"
        : "response.function_call_arguments";
      const value = custom ? step.input : JSON.stringify(step.input);
      event(`${prefix}.delta`, {
        output_index,
        item_id: item.id,
        delta: value,
      });
      event(`${prefix}.done`, {
        output_index,
        item_id: item.id,
        [custom ? "input" : "arguments"]: value,
      });
    } else {
      event("response.content_part.added", {
        output_index,
        content_index: 0,
        item_id: item.id,
        part: { type: "output_text", text: "", annotations: [] },
      });
      event("response.output_text.delta", {
        output_index,
        content_index: 0,
        item_id: item.id,
        delta: step.text,
      });
      event("response.output_text.done", {
        output_index,
        content_index: 0,
        item_id: item.id,
        text: step.text,
      });
      event("response.content_part.done", {
        output_index,
        content_index: 0,
        item_id: item.id,
        part: item.content[0],
      });
    }
    event("response.output_item.done", { output_index, item });
  }
  event("response.completed", { response: result });
  response.end();
}
