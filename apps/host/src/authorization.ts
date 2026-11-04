import type { Request } from "@iori/protocol";

export function authorizationError(
  registered: boolean,
  request: Request,
): "not_registered" | undefined {
  if (
    !registered &&
    (request.kind !== "request" || request.method !== "pair")
  ) {
    return "not_registered";
  }
  return undefined;
}
