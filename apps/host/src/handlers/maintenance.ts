import type { MaintenanceMethod, Response } from "@iori/protocol";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse } from "../host-transport.ts";

export async function handleMaintenance(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<"host.info" | MaintenanceMethod>,
): Promise<void> {
  const { hostInfo, maintenance } = host;
  const { session, stream } = context;
  let response: Response<unknown>;
  switch (request.method) {
    case "host.info":
      response = { ok: true, result: await hostInfo() };
      break;
    case "host.update.prepare":
      response = {
        ok: true,
        result: await maintenance.plan("update", request.params.version),
      };
      break;
    case "host.uninstall.prepare":
      response = { ok: true, result: await maintenance.plan("uninstall") };
      break;
    case "host.restart.prepare":
      response = { ok: true, result: await maintenance.plan("restart") };
      break;
    case "host.maintenance.status":
      response = {
        ok: true,
        result: await maintenance.lookup(
          session.publicKey,
          request.params.operationId,
        ),
      };
      break;
    case "host.uninstall":
    case "host.update":
    case "host.restart": {
      const status = await maintenance.execute(
        session.publicKey,
        request.operationId,
        request.method === "host.uninstall"
          ? "uninstall"
          : request.method === "host.update"
            ? "update"
            : "restart",
        request.params,
      );
      try {
        await sendStreamResponse(stream, { ok: true, result: status });
      } finally {
        if (request.method !== "host.update")
          await maintenance.afterResponse(status);
      }
      return;
    }
    default:
      return request satisfies never;
  }
  await sendStreamResponse(stream, response);
}
