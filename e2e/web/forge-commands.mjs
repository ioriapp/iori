import { issueWorktreeName } from "../../packages/protocol/src/worktree-name.ts";
import { waitFor } from "../../verification/ui.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import { closeSidebar, openSidebar } from "../connection/scenario.mjs";
import { forgeCapture } from "./forge-issue-start.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const field = (name) => `[data-iori-field="${name}"]`;
const pane = '[data-iori-view="issues"]:not([hidden])';
const row = (number) =>
  `${pane} [data-iori-part="issues-rows"] [data-iori-issue="${number}"]`;
const detail = (number) =>
  `${pane} [data-iori-part="issue-detail"][data-iori-issue-detail="${number}"]`;
const issuesButton = (path) =>
  `${action("repository-issues")}[data-iori-repository-path=${JSON.stringify(path)}]`;
const creator = '[data-iori-view="worktree-create"]';
/** The ASCII Issue title is passed from its detail into the worktree form. */
export async function forgeCommandsScenario({
  client,
  tokenFixture,
  mobile,
  desktop,
  shot,
  record,
}) {
  const screen = client.screen;
  const { capture, wide } = forgeCapture(client, shot, "IORI_START_CAPTURE");
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('request failed');return r.result;})()`,
    );
  await openFolder(screen, tokenFixture.clonePath, false);
  await request("forge.token.set", {
    origin: tokenFixture.origin,
    token: tokenFixture.readToken,
  });

  // An ASCII title becomes the number and the delegated worktree's name.
  const ascii = issueWorktreeName(
    tokenFixture.issueNumber,
    "Keep the token out of the logs",
  );
  await openSidebar(screen);
  await screen.click(issuesButton(tokenFixture.clonePath));
  await screen.reveal(row(tokenFixture.issueNumber));
  await screen.click(row(tokenFixture.issueNumber), { scroll: false });
  await screen.wait(detail(tokenFixture.issueNumber));
  const start = `${detail(tokenFixture.issueNumber)} ${action("issue-start")}`;
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(start)})?.disabled === false`,
    ),
  );
  await screen.click(start);
  await screen.wait(creator);
  await waitFor(
    () => screen.value(field("worktree-name")),
    (value) => value === ascii,
    undefined,
    "ASCIIの題名を番号と整えた題名の名前にする",
  );
  await capture("pc-issue-start-ascii-creator");
  await wide("wqhd-issue-start-ascii-creator");
  await screen.click(action("worktree-create-close"));
  if (process.env.IORI_START_CAPTURE === "1") {
    await mobile({ width: 390, height: 844 });
    await openSidebar(screen);
    await screen.tap(issuesButton(tokenFixture.clonePath));
    await closeSidebar(screen);
    await screen.wait(detail(tokenFixture.issueNumber));
    await screen.tap(start);
    await screen.wait(creator);
    await capture("phone-issue-start-ascii-creator");
    await screen.tap(action("worktree-create-close"));
    await desktop();
  }
  await record(
    "ASCIIの題名のIssueから開いた作成画面は、番号とdelegateと同じ整え方の題名を名前にする",
    { name: ascii },
  );
}
