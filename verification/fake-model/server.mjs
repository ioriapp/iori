import { createServer } from "node:http";
import { anthropicMessages } from "./anthropic-messages.mjs";
import { openaiResponses } from "./openai-responses.mjs";

function historyText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part.type === "tool_result"
        ? historyText(part.content)
        : (part.text ?? ""),
    )
    .join("\n");
}

function selectStep(history, scripts, format, tools) {
  let deliveryPaths = [];
  let deliveryResponses = 0;
  let awaitingDeliveryResult = false;
  let marker;
  let index = 0;
  let assistant = false;
  for (const item of history) {
    const isAssistant =
      item.role === "assistant" ||
      ["function_call", "custom_tool_call"].includes(item.type);
    const isToolOutput = [
      "function_call_output",
      "custom_tool_call_output",
    ].includes(item.type);
    if (item.role === "user" || isToolOutput) {
      const parts = Array.isArray(item.content) ? item.content : [];
      const userText =
        item.role === "user"
          ? historyText(
              typeof item.content === "string"
                ? item.content
                : parts.filter((part) => part.type !== "tool_result"),
            )
          : "";
      const results = isToolOutput
        ? item.output
        : parts.filter((part) => part.type === "tool_result");
      const toolText = historyText(results);
      // Delivery wording is owned by teams/manager.ts. This is the only
      // prompt transport we interpret; the CLI itself reads these files.
      const delivery =
        /(?:^|\[iori\] Parent \w+: |Parent message: )Open the files? (.+?) with your file-reading tool \((?:it is a normal file|these are normal files)/mu.exec(
          userText,
        );
      const readDelivery =
        /(?:^|\n)Read (.+?) and follow its instructions\.(?: Then read (.+?) and follow its instructions\.)?(?:$|\n)/mu.exec(
          userText,
        );
      if (delivery || readDelivery) {
        deliveryPaths = delivery
          ? delivery[1].split(" and ")
          : readDelivery.slice(1).filter(Boolean);
        deliveryResponses = 0;
        awaitingDeliveryResult = false;
        marker = undefined;
        index = 0;
      }
      const markerText =
        userText + (awaitingDeliveryResult ? "\n" + toolText : "");
      const matches = [...markerText.matchAll(/\[fake-model:([\w-]+)\]/gu)];
      if (matches.length) {
        marker = matches.at(-1)[1];
        index = 0;
      }
      if (isToolOutput || parts.some((part) => part.type === "tool_result"))
        awaitingDeliveryResult = false;
    } else if (isAssistant && !assistant) {
      index++;
      if (deliveryResponses < deliveryPaths.length) {
        deliveryResponses++;
        awaitingDeliveryResult = true;
      }
    }
    assistant = isAssistant;
  }
  if (deliveryResponses < deliveryPaths.length) {
    const file = deliveryPaths[deliveryResponses];
    const read = tools.find((tool) => tool.name === "read");
    return {
      marker: undefined,
      index: deliveryResponses,
      delivery: true,
      step:
        format === "anthropic-messages"
          ? { tool: "Read", input: { file_path: file } }
          : read
            ? {
                tool: "read",
                input: read.parameters?.properties?.filePath
                  ? { filePath: file }
                  : { path: file },
              }
            : {
                tool: "exec_command",
                input: {
                  cmd: "cat -- '" + file.replaceAll("'", "'\\''") + "'",
                },
              },
    };
  }
  return { marker, index, step: scripts[marker]?.[index] ?? { text: "OK" } };
}

// Keep only counts and the presence of explicitly declared fixture tokens.
function inputEvidence(body, expectTokens) {
  let imageCount = 0;
  const tokensPresent = Object.fromEntries(
    expectTokens.map((token) => [token, false]),
  );
  const visit = (value) => {
    if (typeof value === "string") {
      for (const token of expectTokens)
        if (value.includes(token)) tokensPresent[token] = true;
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      // The fake model's own earlier replies must not satisfy a fixture token.
      if (
        value.role === "assistant" ||
        ["function_call", "custom_tool_call"].includes(value.type)
      )
        return;
      if (["image", "input_image"].includes(value.type)) imageCount++;
      else for (const item of Object.values(value)) visit(item);
    }
  };
  for (const value of [
    body.system,
    body.instructions,
    body.messages,
    body.input,
  ])
    visit(value);
  return { imageCount, tokensPresent };
}

export async function startFakeModel({ scripts }) {
  const requests = [];
  let usesPreviousResponseId = false;
  const timers = new Set();
  const server = createServer(async (request, response) => {
    const chunks = [];
    try {
      for await (const chunk of request) chunks.push(chunk);
    } catch {
      return;
    }
    let body;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "Invalid JSON request",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    const path = new URL(request.url, "http://localhost").pathname;
    const format = path.endsWith("/messages")
      ? "anthropic-messages"
      : path.endsWith("/responses")
        ? "openai-responses"
        : "other";
    if (format === "openai-responses" && body.previous_response_id)
      usesPreviousResponseId = true;
    const history =
      format === "anthropic-messages"
        ? (body.messages ?? [])
        : Array.isArray(body.input)
          ? body.input
          : [];
    const { marker, index, step, delivery } = selectStep(
      history,
      scripts,
      format,
      body.tools ?? [],
    );
    requests.push({
      at: new Date().toISOString(),
      method: request.method,
      path,
      format,
      model: body.model,
      ...inputEvidence(body, step.expectTokens ?? []),
      marker: marker ?? null,
      step: marker ? index : null,
      toolsProvided: body.tools !== undefined,
      tools: (body.tools ?? []).map((tool) => tool.name ?? tool.type),
    });
    const send = () => {
      if (response.destroyed) return;
      if (step.error) {
        const { status, type, message } = step.error;
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify(
            format === "anthropic-messages"
              ? {
                  type: "error",
                  error: { type, message },
                  request_id: "req_fake_model",
                }
              : {
                  error: {
                    type,
                    message,
                    param: null,
                    code: "model_not_found",
                  },
                },
          ),
        );
        return;
      }
      if (format === "anthropic-messages")
        anthropicMessages(response, body, step);
      else if (format === "openai-responses")
        openaiResponses(response, body, step);
      else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ text: "OK" }));
      }
    };
    const start = () => {
      if (!step.after) return send();
      let ready = send;
      response.once("close", () => {
        ready = undefined;
      });
      step.after.then(() => ready?.());
    };
    // Real models normally take at least a second to respond; existing checks
    // observe the active state before a scripted reply ends the turn. Reading a
    // delivered file keeps the turn active, and a held step starts at once so
    // the CLI can interrupt an active stream, as it does with a real model.
    const delayMs =
      step.delayMs ?? (marker && !delivery && !step.hold ? 1000 : 0);
    if (delayMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        start();
      }, delayMs);
      timers.add(timer);
      response.once("close", () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
    } else start();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    requests,
    get usesPreviousResponseId() {
      return usesPreviousResponseId;
    },
    close: () => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
