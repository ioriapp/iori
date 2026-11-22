import { worktreeOptions } from "../worktree-creation.ts";
import type { Event, Response } from "@iori/protocol";
import { browseFolders, WorkspaceError } from "../workspace.ts";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse, responseError } from "../host-transport.ts";

export async function handleWorkspaces(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<`worktrees.${string}` | `folders.${string}`>,
): Promise<void> {
  const { store, events, workspaces, worktreeCreator, worktreeRemover } = host;
  const { session, operation, stream } = context;
  let mutationEvent: Event | undefined;
  let response: Response<unknown>;
  switch (request.method) {
    case "worktrees.preview":
    case "worktrees.cleanup":
      try {
        response = {
          ok: true,
          result: await worktreeRemover.preview(
            request.params.path,
            request.method === "worktrees.cleanup",
          ),
        };
      } catch {
        response = responseError("git_failed");
      }
      break;
    case "worktrees.remove":
      try {
        response = {
          ok: true,
          result: await worktreeRemover.remove(
            operation,
            request.params.previewId,
            request.params.paths,
            request.params.branches,
            request.params.recheck,
          ),
        };
        mutationEvent = { type: "folders.changed" };
      } catch {
        response = responseError("git_failed");
      }
      break;
    case "worktrees.options":
      try {
        response = {
          ok: true,
          result: await worktreeOptions(request.params.path).then(
            (options) => ({
              ...options,
              setupCommand: store.worktreeSetupCommand(options.mainPath),
            }),
          ),
        };
      } catch {
        response = responseError("git_failed");
      }
      break;
    case "worktrees.create":
      response = {
        ok: true,
        result: await worktreeCreator.create(
          operation,
          request.params.path,
          request.params.name,
          request.params.baseBranch,
          request.params.setupCommand,
        ),
      };
      mutationEvent = { type: "folders.changed" };
      break;
    case "worktrees.creation":
      response = {
        ok: true,
        result: {
          creation: await worktreeCreator.status({
            clientPublicKey: session.publicKey,
            operationId: request.params.creationId,
          }),
        },
      };
      break;
    case "folders.browse":
      try {
        response = {
          ok: true,
          result: await browseFolders(request.params.path),
        };
      } catch (error) {
        response = responseError(
          error instanceof WorkspaceError ? error.code : "internal_error",
        );
      }
      break;
    case "folders.history":
      response = { ok: true, result: await workspaces.history() };
      break;
    case "folders.open": {
      const mutation = await workspaces.open(operation, request.params.path);
      response = mutation.response;
      if (mutation.changed) mutationEvent = { type: "folders.changed" };
      break;
    }
    case "folders.sidebar.reorder": {
      const mutation = workspaces.reorderSidebar(
        operation,
        request.params.paths,
      );
      response = mutation.response;
      if (mutation.changed) mutationEvent = { type: "folders.changed" };
      break;
    }
    case "folders.sidebar.remove": {
      const mutation = workspaces.removeSidebarTarget(
        operation,
        request.params.path,
      );
      response = mutation.response;
      if (mutation.changed) mutationEvent = { type: "folders.changed" };
      break;
    }
    default:
      return request satisfies never;
  }
  try {
    await sendStreamResponse(stream, response);
  } finally {
    if (mutationEvent) events.publish(mutationEvent);
  }
}
