import { worktreeSetup } from "../worktree-creation.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Response } from "@iori/protocol";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { HostServices, MethodRequest, RequestContext } from "./context.ts";
import { sendStreamResponse } from "../host-transport.ts";

// A first instruction from the worktree screen is delivered as a file that
// the CLI reads, as Automations deliver theirs (worktrees.md).
async function withInstruction<T>(
  root: string,
  instruction: string | undefined,
  launch: (file?: string) => Promise<T>,
): Promise<T> {
  if (instruction === undefined) return launch();
  const directory = join(root, "launch-instructions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${randomUUID()}.md`);
  await writeFile(file, instruction, { mode: 0o600 });
  try {
    return await launch(file);
  } finally {
    // The CLI reads the copy delivered to its session; this one is done.
    await rm(file, { force: true });
  }
}

export async function handleTerminal(
  host: HostServices,
  context: RequestContext,
  request: MethodRequest<
    `terminal.${string}` | "cli.launch" | "cli.resume" | "team.launch"
  >,
): Promise<void> {
  const { store } = host;
  const { operation, stream } = context;
  let response: Response<unknown>;
  switch (request.method) {
    case "team.launch": {
      const { teamId, cwd, setupWorktree, instruction } = request.params;
      const setup = setupWorktree ? await worktreeSetup(cwd, store) : undefined;
      response = await withInstruction(host.root, instruction, (file) =>
        host.teamManager.launch(operation, teamId, cwd, setup, file),
      );
      break;
    }
    case "cli.launch": {
      const { cliId, cwd, setupWorktree, instruction } = request.params;
      const setup = setupWorktree ? await worktreeSetup(cwd, store) : undefined;
      response = await withInstruction(host.root, instruction, (file) =>
        host.terminalManager.createTerminal(
          operation,
          cwd,
          undefined,
          cliId,
          undefined,
          setup,
          file
            ? {
                // The user's own launch of this CLI: no model, effort or
                // permission of a team's candidate is added.
                candidate: {
                  id: cliId,
                  cli: cliId,
                  model: "",
                  tools: [],
                  minimum: "",
                },
                instructionFile: file,
              }
            : undefined,
        ),
      );
      break;
    }
    case "terminal.list":
      response = host.terminalManager.list();
      break;
    case "terminal.create":
      response = await host.terminalManager.createTerminal(
        operation,
        request.params.cwd,
        request.params.shell,
      );
      break;
    case "terminal.setup":
      response = await host.terminalManager.resolveSetup(
        operation,
        request.params.terminalId,
        request.params.action,
      );
      break;
    case "cli.resume":
      response = await host.terminalManager.resumeCli(
        operation,
        request.params.terminalId,
      );
      break;
    case "terminal.image.write":
      response = await host.terminalManager.writeImage(request.params);
      break;
    case "terminal.approval.respond":
      response = {
        ok: true,
        result: await host.terminalManager.respondApproval(
          request.params.terminalId,
          request.params.approvalId,
          request.params.decision,
        ),
      };
      break;
    case "terminal.close":
      response = await host.terminalManager.closeTerminal(
        operation,
        request.params.terminalId,
        request.params.confirm ?? false,
      );
      break;
    case "terminal.defaultShell.set":
      response = await host.terminalManager.setDefaultShell(
        operation,
        request.params.shell,
      );
      break;
    default:
      return request satisfies never;
  }
  await sendStreamResponse(stream, response);
}
