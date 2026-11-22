import type { Response } from "@iori/protocol";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse } from "../host-transport.ts";

export async function handleAutomations(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<`automation.${string}`>,
): Promise<void> {
  const { store } = host;
  const { operation, stream } = context;
  let response: Response<unknown>;
  switch (request.method) {
    case "automation.list":
      response = { ok: true, result: host.automationManager.list() };
      break;
    case "automation.history":
      response = {
        ok: true,
        result: { runs: store.automationRuns(request.params.id) },
      };
      break;
    case "automation.save":
      response = await host.automationManager.save(
        operation,
        request.params.id,
        request.params.definition,
      );
      break;
    case "automation.delete":
      response = await host.automationManager.remove(
        operation,
        request.params.id,
      );
      break;
    case "automation.run":
      response = await host.automationManager.run(operation, request.params.id);
      break;
    case "automation.regenerateToken":
      response = await host.automationManager.regenerateToken(
        operation,
        request.params.id,
      );
      break;
    case "automation.received":
      response = await host.automationManager.received(request.params.id);
      break;
    default:
      return request satisfies never;
  }
  await sendStreamResponse(stream, response);
}
