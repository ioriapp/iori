import type { Response } from "@iori/protocol";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse } from "../host-transport.ts";

export async function handleTeams(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<`teams.${string}`>,
): Promise<void> {
  const { store } = host;
  const { operation, stream } = context;
  let response: Response<unknown>;
  switch (request.method) {
    case "teams.boards":
      response = { ok: true, result: host.teamManager.boards() };
      break;
    case "teams.board":
      response = {
        ok: true,
        result: await host.teamManager.board(request.params.cwd),
      };
      break;
    case "teams.records":
      response = { ok: true, result: host.teamManager.records(request.params) };
      break;
    case "teams.task.history":
      response = {
        ok: true,
        result: await host.teamManager.taskHistory(request.params.taskId),
      };
      break;
    case "teams.children":
      response = {
        ok: true,
        result: host.teamManager.listChildren(request.params),
      };
      break;
    case "teams.child.stop":
      response = await host.teamManager.stopChild(
        operation,
        request.params.childId,
      );
      break;
    case "teams.list":
    case "teams.read":
    case "teams.create":
    case "teams.save":
    case "teams.memo":
    case "teams.restore":
    case "teams.duplicate":
    case "teams.hidden.set":
    case "teams.delete":
    case "teams.settings":
      response = store.teamOperation(operation, request.method, request.params);
      if (response.ok) host.teamManager?.conditionsChanged();
      break;
    default:
      return request satisfies never;
  }
  await sendStreamResponse(stream, response);
}
