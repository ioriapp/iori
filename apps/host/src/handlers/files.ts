import { handleFileManage } from "../files-manage.ts";
import { FilePutFailure } from "../files-writing.ts";
import {
  isGitWriteMethod,
  type GitWriteMethod,
  isFilesManageMethod,
  isFilesTransferMethod,
  type FilesManageMethod,
  type FilesTransferMethod,
  type ReadMethod,
} from "@iori/protocol";
import { handleFileRead } from "../files-reading.ts";
import { handleGitWrite } from "../git-write.ts";
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
  request: MethodRequest<
    FilesManageMethod | FilesTransferMethod | GitWriteMethod | ReadMethod
  >,
): Promise<void> {
  if (
    matchesMethod(request, isFilesManageMethod) ||
    matchesMethod(request, isFilesTransferMethod)
  ) {
    try {
      const result = matchesMethod(request, isFilesManageMethod)
        ? await handleFileManage(request)
        : await fileUploads.request(
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
    if (matchesMethod(request, isGitWriteMethod)) {
      const result = await handleGitWrite(request, signal);
      await sendStreamResponse(stream, { ok: true, result });
      return;
    }
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
