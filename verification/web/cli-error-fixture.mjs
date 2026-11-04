import { createServer } from "node:http";

// Exercise the real CLI's non-retryable API error handling without a model call.
export async function prepareCliErrorFixture(model) {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: {
          message: `The model '${model}' does not exist.`,
          type: "invalid_request_error",
          code: "model_not_found",
        },
      }),
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
