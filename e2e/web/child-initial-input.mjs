import { fileURLToPath } from "node:url";
import {
  addCliByCommand,
  openAgents,
  returnToWorktree,
} from "./agents-navigation.mjs";
import { observed, observedTerminalMode } from "../terminal/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

export async function childInitialInputScenario({
  client,
  teamId,
  definition,
  parentId,
  parentCommand,
  record,
}) {
  const screen = client.screen;
  const request = (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const result=await connection.requestHost(host,${JSON.stringify(method)},${JSON.stringify(params)});if(!result.ok)throw new Error('Host fixture request failed');return result.result;})()`,
    );
  await openAgents(screen);
  const cli = await addCliByCommand(
    screen,
    "No ready CLI",
    fileURLToPath(new URL("./fixtures/no-ready-cli.mjs", import.meta.url)),
  );
  const role = {
    ...definition.roles[0],
    id: "no-ready",
    name: "No ready",
    split: false,
    reuse: true,
    candidates: {
      high: [],
      low: [],
      medium: [
        { id: "no-ready-candidate", cli, model: "", tools: [], minimum: "" },
      ],
    },
  };
  await request("teams.save", {
    teamId,
    definition: { ...definition, roles: [...definition.roles, role] },
  });
  await returnToWorktree(screen);
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  const delegated = await parentCommand([
    "delegate",
    "--role",
    role.name,
    "--difficulty",
    "low",
    "--title",
    "Initial request without ready signals",
    "--worktree",
    "parent",
    "--body",
    "Receive the first request.",
  ]);
  const child = await waitFor(async () =>
    (await request("teams.children", {})).children.find(
      (entry) => entry.id === delegated.data.child && entry.terminalId,
    ),
  );
  await screen.click(`[data-iori-child-id="${child.id}"] .nav-child-button`);
  await screen.wait(
    `[data-iori-terminal-id="${child.terminalId}"][data-iori-stream-state="ready"]`,
  );
  await observed(client, "NO_READY_SCREEN");
  await observedTerminalMode(client, "bracketedPaste", false);
  // This is CLI output after reading stdin, never the terminal's input echo.
  await observed(client, "INITIAL_REQUEST_RECEIVED:Open the file");
  await parentCommand([
    "send",
    child.id,
    "--kind",
    "request",
    "--body",
    "INITIAL_INPUT_BARRIER",
  ]);
  await observed(client, "INITIAL_INPUT_COUNT=1");
  await parentCommand([
    "finish",
    child.id,
    "--decision",
    "accept",
    "--reason",
    "Initial request received once",
    "--worktree",
    "keep",
  ]);
  await record(
    "hookもブラケットペーストの印もないCLIの子に最初の依頼が一度だけ届く",
  );
}
