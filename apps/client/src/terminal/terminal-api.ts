import {
  parseResult,
  responseSchema,
  type Request,
  type RequestMethod,
  type ResultByMethod,
} from "@iori/protocol";
import { native } from "../native.ts";

type TerminalMethod = Extract<
  RequestMethod,
  | "terminal.list"
  | "terminal.create"
  | "terminal.close"
  | "terminal.image.write"
  | "terminal.defaultShell.set"
>;

export class TerminalRequestError extends Error {}

export async function terminalRequest<M extends TerminalMethod>(
  connectionId: string,
  method: M,
  params: Record<string, unknown>,
  operationId: string = crypto.randomUUID(),
): Promise<ResultByMethod[M]> {
  const request = {
    kind: "request",
    operationId,
    method,
    params,
  } as Request;
  const response = responseSchema.parse(
    JSON.parse(await native.request(connectionId, JSON.stringify(request))),
  );
  if (!response.ok) throw new TerminalRequestError(response.error.code);
  return parseResult(method, response.result);
}
