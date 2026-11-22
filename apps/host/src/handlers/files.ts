import { FilePutFailure } from "../files-writing.ts";
import {
  isFilesTransferMethod,
  type FilesTransferMethod,
  type ReadMethod,
} from "@iori/protocol";
import { handleFileRead } from "../files-reading.ts";
import { handleGitRead } from "../git-reading.ts";
import { ReadingFailure } from "../reading-failure.ts";
import {
  matchesMethod,
  type HostServices,
  type RequestContext,
  type MethodRequest,
} from "./context.ts";
import { sendStreamResponse, responseError } from "../host-transport.ts";

export async function handleFiles(
  { fileUploads }: HostServices,
  { session, stream, signal }: RequestContext,
  request: MethodRequest<FilesTransferMethod | ReadMethod>,
): Promise<void> {
  if (matchesMethod(request, isFilesTransferMethod)) {
    try {
      const result = await fileUploads.request(
        session.publicKey,
        request.method,
        request.params,
      );
      await sendStreamResponse(stream, { ok: true, result });
    } catch (error) {
      await sendStreamResponse(
        stream,
        responseError(
          error instanceof FilePutFailure ? error.code : "put_failed",
        ),
      );
    }
    return;
  }
  try {
    const result = request.method.startsWith("files.")
      ? await handleFileRead(request.method, request.params, signal)
      : await handleGitRead(request.method, request.params, signal);
    await sendStreamResponse(stream, { ok: true, result });
  } catch (error) {
    if (signal?.aborted) return;
    await sendStreamResponse(
      stream,
      responseError(
        error instanceof ReadingFailure ? error.code : "internal_error",
      ),
    );
  }
}
