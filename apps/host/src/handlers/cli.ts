import type { Response } from "@iori/protocol";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse } from "../host-transport.ts";

export async function handleCli(
  host: HostServices,
  context: RequestContext,
  request: Exclude<
    MethodRequest<`cli.${string}`>,
    { method: "cli.launch" | "cli.resume" }
  >,
): Promise<void> {
  const { store, events } = host;
  const { session, operation, stream } = context;
  let response: Response<unknown>;
  switch (request.method) {
    case "cli.models":
      response = await host.terminalManager.cliModels(request.params.cliId);
      break;
    case "cli.list":
      response = await host.terminalManager.listClis(
        request.params.refreshUsage,
      );
      break;
    case "cli.usage.refresh":
      await host.terminalManager.requestCliUsageRefresh(request.params.cliId);
      response = { ok: true, result: {} };
      break;
    case "cli.order.set": {
      const previous = store.terminalOperationResult<{ order: string[] }>(
        operation,
      );
      if (previous) {
        response = { ok: true, result: previous };
        break;
      }
      const known = await host.terminalManager.cliDefinitionIds();
      const order = [
        ...new Set(request.params.order.filter((id) => known.has(id))),
      ];
      store.saveCliOrder(order);
      const result = { order };
      store.saveTerminalOperationResult(operation, result);
      events.publish({ type: "cli.order.changed", order });
      response = { ok: true, result };
      break;
    }
    case "cli.definition.file.read":
      response = await host.terminalManager.readCliDefinitionFile(
        request.params.cliId,
        request.params.name,
      );
      break;
    case "cli.definition.file.write":
      response = {
        ok: true,
        result: await host.terminalManager.writeDefinitionFile(
          session.publicKey,
          request.params,
        ),
      };
      break;
    case "cli.definition.files.discard":
      response = {
        ok: true,
        result: await host.terminalManager.discardDefinitionFiles(
          session.publicKey,
          request.params.uploadIds,
        ),
      };
      break;
    case "cli.icon.read":
      response = {
        ok: true,
        result: await host.terminalManager.readCliIcon(
          request.params.hash,
          request.params.offset,
        ),
      };
      break;
    case "cli.icon.set":
      response = await host.terminalManager.setCliIcon(
        operation,
        request.params,
      );
      break;
    case "cli.definition.check":
      response = await host.terminalManager.checkCliDefinition(
        request.params.definition,
        request.params.cliId,
        request.params.files,
        session.publicKey,
      );
      break;
    case "cli.definition.save":
      response = await host.terminalManager.saveCliDefinition(
        operation,
        request.params.definition,
        request.params.cliId,
        request.params.files,
      );
      if (response.ok) host.teamManager?.conditionsChanged();
      break;
    case "cli.definition.simple":
      response = await host.terminalManager.saveSimpleCliDefinition(
        operation,
        request.params.simple,
        request.params.cliId,
      );
      if (response.ok) host.teamManager?.conditionsChanged();
      break;
    case "cli.hidden.set": {
      const previous = store.terminalOperationResult<{
        cliId: string;
        hidden: boolean;
      }>(operation);
      if (previous) {
        response = { ok: true, result: previous };
        break;
      }
      const known = await host.terminalManager.cliDefinitionIds();
      if (!known.has(request.params.cliId)) {
        response = { ok: false, error: { code: "invalid_request" } };
        break;
      }
      store.saveCliHidden(request.params.cliId, request.params.hidden);
      store.saveTerminalOperationResult(operation, request.params);
      events.publish({ type: "cli.hidden.changed", ...request.params });
      response = { ok: true, result: request.params };
      break;
    }
    case "cli.arguments.set": {
      const previous = store.terminalOperationResult<{
        cliId: string;
        arguments: string;
      }>(operation);
      if (previous) {
        response = { ok: true, result: previous };
        break;
      }
      store.saveCliStartupArguments(
        request.params.cliId,
        request.params.arguments,
      );
      store.saveTerminalOperationResult(operation, request.params);
      response = { ok: true, result: request.params };
      break;
    }
    case "cli.definition.remove":
      response = await host.terminalManager.removeCliDefinition(
        operation,
        request.params.cliId,
      );
      if (response.ok) host.teamManager?.conditionsChanged();
      break;
    default:
      return request satisfies never;
  }
  await sendStreamResponse(stream, response);
}
