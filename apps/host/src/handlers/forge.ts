import { githubAccounts } from "../forge/github.ts";
import {
  repositoryGitSettings,
  repositoryMainPath,
} from "../repository-git-settings.ts";
import { discoveredForgeOrigins } from "../forge/sites.ts";
import { answerForgeCi } from "../forge-ci.ts";
import { isForgeIssueMethod, type Event, type Response } from "@iori/protocol";
import {
  matchesMethod,
  type HostServices,
  type MethodRequest,
  type RequestContext,
} from "./context.ts";
import { answerForgeIssues } from "../forge-issues.ts";
import { sendStreamResponse, responseError } from "../host-transport.ts";

export async function handleForge(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<
    `forge.${string}` | `repository.${string}` | "github.accounts"
  >,
): Promise<void> {
  const { store, events, forge, forgeSites, ciLogKeep } = host;
  const { session, operation, stream, signal } = context;
  if (matchesMethod(request, isForgeIssueMethod)) {
    const answer = await answerForgeIssues(
      request,
      store,
      forge.detection,
      signal,
    );
    if (!signal?.aborted) await sendStreamResponse(stream, answer);
    return;
  }
  let mutationEvent: Event | undefined;
  let response: Response<unknown>;
  switch (request.method) {
    case "github.accounts":
      try {
        response = { ok: true, result: await githubAccounts(store, true) };
      } catch {
        response = responseError("read_failed");
      }
      break;
    case "repository.git.settings":
      try {
        response = {
          ok: true,
          result: await repositoryGitSettings(
            request.params.path,
            store,
            forge.detection,
          ),
        };
      } catch {
        response = responseError("git_failed");
      }
      break;
    case "repository.git.set":
      try {
        const mainPath = await repositoryMainPath(request.params.path);
        const mutation = store.saveRepositoryGitSettings(
          operation,
          mainPath,
          request.params,
        );
        response = mutation.response;
        if (mutation.changed) {
          if (request.params.githubAccount !== undefined)
            forge.repositoryChanged(mainPath);
          else events.publish({ type: "forge.settings.changed" });
        }
      } catch {
        response = responseError("git_failed");
      }
      break;
    case "forge.mapping.set": {
      const { remoteHost, webUrl } = request.params;
      const mutation = store.setForgeMapping(operation, { remoteHost, webUrl });
      response = mutation.response;
      if (mutation.changed) forge.mappingsChanged([remoteHost]);
      break;
    }
    case "forge.mapping.remove": {
      const mutation = store.removeForgeMapping(
        operation,
        request.params.remoteHost,
      );
      response = mutation.response;
      if (mutation.changed) forge.mappingsChanged([request.params.remoteHost]);
      break;
    }
    case "forge.watch":
      forge.watch(session, request.params);
      await sendStreamResponse(stream, { ok: true, result: {} });
      return;
    case "forge.sites":
      try {
        response = {
          ok: true,
          result: await forgeSites.list(
            await discoveredForgeOrigins(store, forge.detection),
          ),
        };
      } catch {
        response = responseError("read_failed");
      }
      break;
    case "forge.token.set":
      try {
        const result = await forgeSites.register(
          request.params.origin,
          request.params.token,
          signal,
        );
        response = { ok: true, result };
        if ("site" in result) {
          forge.siteChanged(request.params.origin, true);
          mutationEvent = {
            type: "forge.token.changed",
            origin: request.params.origin,
          };
        }
      } catch (error) {
        // The Client cancelled: nothing was saved and nothing is answered.
        if (signal?.aborted) throw error;
        response = responseError("internal_error");
      }
      break;
    case "forge.token.remove":
      try {
        await forgeSites.remove(request.params.origin);
        response = { ok: true, result: { origin: request.params.origin } };
        forge.siteChanged(request.params.origin, true);
        mutationEvent = {
          type: "forge.token.changed",
          origin: request.params.origin,
        };
      } catch {
        response = responseError("internal_error");
      }
      break;
    case "forge.site.check":
      try {
        response = {
          ok: true,
          result: { site: await forgeSites.check(request.params.origin) },
        };
        forge.siteChanged(request.params.origin, false);
      } catch {
        response = responseError("read_failed");
      }
      break;
    case "forge.ci":
    case "forge.ci.log":
      response = await answerForgeCi(
        request,
        store,
        forge.detection,
        signal,
        ciLogKeep(session),
      );
      // The Client stopped the stream: the read and its gh child stopped too.
      if (signal?.aborted) return;
      break;
    default:
      return request satisfies never;
  }
  try {
    await sendStreamResponse(stream, response);
  } finally {
    if (mutationEvent) events.publish(mutationEvent);
  }
}
