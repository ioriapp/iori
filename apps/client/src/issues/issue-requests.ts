import type {
  ForgeIssueMethod,
  RequestParamsByMethod,
  ResultByMethod,
} from "@iori/protocol";
import { connection } from "../connection.ts";
import { ReadConnectionLost, ReadError } from "../reading/transport.ts";

/**
 * Reads a repository's Issues over the Host connection. Aborting the signal
 * cancels the read on the Host too (a newer choice, a closed View), as every
 * cancellable Host request does. Without a connection it fails with
 * ReadConnectionLost and the View reads again later.
 */
export async function requestIssues<M extends ForgeIssueMethod>(
  hostKey: string,
  method: M,
  params: RequestParamsByMethod[M],
  signal?: AbortSignal,
): Promise<ResultByMethod[M]> {
  const connected = () =>
    connection.getSnapshot().connectedHosts.includes(hostKey);
  if (!connected()) throw new ReadConnectionLost();
  let response: Awaited<ReturnType<typeof connection.requestHost<M>>>;
  try {
    response = await connection.requestHost(
      hostKey,
      method,
      params,
      undefined,
      signal,
    );
  } catch {
    if (signal?.aborted) throw signal.reason;
    if (!connected()) throw new ReadConnectionLost();
    throw new ReadError("read_failed");
  }
  if (!response) throw new ReadConnectionLost();
  if (!response.ok)
    throw new ReadError(response.error.code, response.error.forge);
  return response.result;
}
