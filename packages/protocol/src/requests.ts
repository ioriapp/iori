import {
  type ProtocolErrorCode,
  type ValueSchema,
  record,
  string,
  fail,
  type Params,
  type Results,
  parseValue,
  nonEmptyString,
  hasMethod,
} from "./primitives.ts";
import {
  type ReadingWatchRequest,
  readMethods,
  parseReadingWatchRequest,
  isReadMethod,
  readOperationId,
} from "./reading.ts";
import {
  type ForgeReadFailure,
  forgeIntegrationMethods,
} from "./forge-integration.ts";
import { coreMethods } from "./core-methods.ts";
import { automationMethods } from "./automations.ts";
import { cliDefinitionMethods } from "./cli-definitions.ts";
import { filesTransferMethods } from "./files-transfer.ts";
import { forgeCiMethods } from "./forge-ci.ts";
import { forgeIssueMethods } from "./forge-issues.ts";
import { maintenanceMethods } from "./maintenance.ts";
import { teamMethods } from "./team-methods.ts";
const methods = {
  ...coreMethods,
  ...automationMethods,
  ...cliDefinitionMethods,
  ...filesTransferMethods,
  ...forgeCiMethods,
  ...forgeIntegrationMethods,
  ...forgeIssueMethods,
  ...maintenanceMethods,
  ...readMethods,
  ...teamMethods,
};
export type RequestMethod = keyof typeof methods;
export type RequestParamsByMethod = Params<typeof methods>;
export type ResultByMethod = Results<typeof methods>;
export const resultSchemas: {
  [M in RequestMethod]: ValueSchema<ResultByMethod[M]>;
} = methods;
export type RequestByMethod = {
  [M in RequestMethod]: {
    kind: "request";
    operationId: string;
    method: M;
    params: RequestParamsByMethod[M];
  };
}[RequestMethod];

export type Request = RequestByMethod | SubscribeRequest;

export type SubscribeRequest =
  | {
      kind: "subscribe";
      operationId: string;
      method: "events";
      params: Record<string, never>;
    }
  | ReadingWatchRequest;

/** A Forge read that failed also says why (forge.md「失敗の示し方」). */
export type Response<T = unknown> =
  | { ok: true; result: T }
  | {
      ok: false;
      error: { code: ProtocolErrorCode; forge?: ForgeReadFailure };
    };

export type ReceivedResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; forge?: ForgeReadFailure } };

export const responseSchema: ValueSchema<ReceivedResponse> = {
  parse(value) {
    const input = record(value);
    if (input.ok === true) return { ok: true, result: input.result };
    if (input.ok === false) {
      const error = record(input.error);
      return {
        ok: false,
        error: {
          code: string(error.code, "error.code"),
          // The registered Host's own reason for a Forge read, taken as is.
          ...(error.forge === undefined
            ? {}
            : { forge: error.forge as ForgeReadFailure }),
        },
      };
    }
    return fail("response must contain ok");
  },
};

export function parseResponse<M extends RequestMethod>(
  method: M,
  value: unknown,
): ReceivedResponse<ResultByMethod[M]> {
  const response = responseSchema.parse(value);
  if (!response.ok) return response;
  return { ok: true, result: parseResult(method, response.result) };
}

export function parseResult<M extends RequestMethod>(
  method: M,
  value: unknown,
): ResultByMethod[M] {
  return resultSchemas[method].parse(value);
}

export function parseRequest(value: unknown): Request {
  const input = record(value);
  if (input.kind === "subscribe" && input.method === "reading.watch")
    return parseReadingWatchRequest(input);
  const operationId =
    input.kind === "request" && isReadMethod(input.method)
      ? readOperationId(input.operationId)
      : nonEmptyString(input.operationId, "operationId");
  const params = record(input.params);
  if (input.kind === "subscribe" && input.method === "events")
    return { kind: "subscribe", operationId, method: "events", params: {} };
  if (input.kind !== "request") return fail("unsupported stream kind");
  if (!hasMethod(methods, input.method))
    return fail("unsupported request method");
  return {
    kind: "request",
    operationId,
    method: input.method,
    params: parseValue(methods[input.method].params, params),
  } as RequestByMethod;
}
export const requestSchema: ValueSchema<Request> = { parse: parseRequest };
