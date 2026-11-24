import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  test as base,
  expect as playwrightExpect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "../../e2e/ui/fixtures/test.ts";
import { launch } from "../../e2e/ui/fixtures/journeys.ts";
import { stopCliProcesses } from "../cli/home.mjs";
import { registerCleanup } from "../lifecycle.mjs";
import { createHome, ownerConfigHashes } from "./home.mjs";
import { createSample, instruction, prompt } from "./sample.mjs";
import { captureScenes } from "./capture.mjs";
import { clientTerminal } from "./terminals.mjs";
import { splitBoard } from "./layout.mjs";

const output = process.env.IORI_DEMO_OUTPUT!;
const expect = playwrightExpect.configure({ timeout: 0 });
type Home = Awaited<ReturnType<typeof createHome>>;
const test = base.extend<{ demo: Home }>({
  demo: async ({}, use) => {
    const root = await mkdtemp(join(tmpdir(), "iori-demo-"));
    const before = await ownerConfigHashes();
    const home = await createHome(root);
    try {
      await createSample(home.folder);
      await use(home);
    } finally {
      await stopCliProcesses(home.home);
      assert.deepEqual(
        await ownerConfigHashes(),
        before,
        "Owner settings must remain unchanged",
      );
      await writeFile(
        join(output, "isolation.json"),
        JSON.stringify(
          { ownerConfigUnchanged: true, isolatedHome: home.home },
          null,
          2,
        ),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
  hostEnvironment: async ({ demo }, use) => {
    await use(demo.environment);
  },
});

test("README: real implementation, sequential review, acceptance and records", async ({
  page,
  registeredApp: app,
  demo,
}) => {
  await mkdir(output, { recursive: true });
  await demo.trust([demo.folder, dirname(app.folder), join(demo.home, ".tmp")]);
  await app.open(page);
  await openFolder(page, { ...app, folder: demo.folder });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator('[data-iori-action="settings-display"]').click();
  await page.locator('[data-iori-action="display-theme"]').click();
  await page.locator('[data-iori-option="theme-dark"]').click();
  await page.locator('[data-iori-action="terminal-text-size"]').click();
  await page.locator('[data-iori-option="terminal-size-18"]').click();
  await page.locator('[data-iori-action="settings-close"]').click();
  const resize = page.getByRole("separator", {
    name: "Resize sidebar",
    exact: true,
  });
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 50);
  await page.mouse.down();
  await page.mouse.move(240, handle.y + 50, { steps: 16 });
  await page.mouse.up();
  const candidate = (cli: string) => ({
    id: cli,
    cli,
    model: cli === "claude" ? "claude-opus-5-5" : "gpt-6.1-sol",
    permission: cli === "claude" ? "default" : "on-request",
    ...(cli === "codex" ? { sandbox: "workspace-write" } : {}),
    tools: [],
    minimum: "",
  });
  const team = await app.request("teams.create", {
    definition: {
      name: "Web development",
      description: "",
      instruction,
      parent: { ...candidate("claude"), id: "parent" },
      roles: [
        { id: "worker", name: "Worker", cli: "codex" },
        { id: "reviewer", name: "Reviewer", cli: "claude" },
      ].map(({ id, name, cli }) => ({
        id,
        name,
        when: "",
        limit: "",
        reuse: true,
        split: false,
        instruction:
          "Use concise English. Do the requested work, then report to the parent with iori report.",
        request: "",
        report: "",
        candidates: { high: [], medium: [candidate(cli)], low: [] },
      })),
    },
  });
  await app.request("teams.settings", {
    defaultTeam: team.saved.id,
    limits: {},
  });
  await app.request("cli.arguments.set", {
    cliId: "codex",
    arguments:
      '--no-alt-screen -c model_reasoning_effort="medium" -c approvals_reviewer="user"',
  });
  await launch(page, "Web development");
  await expect(visibleTerminal(page)).toHaveAttribute(
    "data-iori-stream-state",
    "ready",
  );
  await expect
    .poll(async () => (await clientTerminal(page)).text)
    .toMatch(/Opus 5.5|claude-opus-5-5/);
  await page.screenshot({
    path: join(output, "parent-ready.png"),
    scale: "device",
  });
  const parent = await terminalId(visibleTerminal(page));
  await splitBoard(page);
  await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
  // The operator checks the full window at README width before any recording.
  // Optional slash commands are ordinary CLI operations, never model responses.
  await writeFile(join(output, "preview-ready"), "ready\n");
  let previewNumber = 0;
  let previousText: string | undefined;
  await mkdir(join(output, "preview"), { recursive: true });
  await expect
    .poll(async () => {
      const commandFile = join(output, "preview-command.json");
      const command = await readFile(commandFile, "utf8").catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
      });
      if (command) {
        await rm(commandFile);
        const { text, key } = JSON.parse(command);
        if (text) await page.keyboard.type(text, { delay: 80 });
        if (key) await page.keyboard.press(key);
      }
      const screen = await clientTerminal(page);
      if (screen.text !== previousText) {
        previousText = screen.text;
        const name = String(previewNumber++).padStart(3, "0");
        await page.screenshot({
          path: join(output, "preview", `${name}.png`),
          scale: "device",
        });
        await writeFile(
          join(output, "preview", `${name}.json`),
          JSON.stringify(screen, null, 2),
        );
        await writeFile(
          join(output, "preview-screen.json"),
          JSON.stringify({ ...screen, image: `preview/${name}.png` }, null, 2),
        );
      }
      return access(join(output, "continue-recording")).then(
        () => true,
        () => false,
      );
    })
    .toBe(true);
  await page.screenshot({
    path: join(output, "readability.png"),
    scale: "device",
  });
  const initialSource = await readFile(
    join(demo.folder, "src/App.jsx"),
    "utf8",
  );
  // The parent is already running. Expand tool output only for the next
  // Claude Code launch (Reviewer), so its initial delivery scrolls away.
  await app.request("cli.arguments.set", {
    cliId: "claude",
    arguments: "--verbose",
  });
  const camera = await captureScenes(page, output);
  const finish = registerCleanup(() => camera.finish());
  try {
    await camera.scene("01-ask", [], async () => {
      await visibleTerminal(page).getByRole("textbox").click();
      await page.mouse.move(930, 565, { steps: 12 });
      await page.keyboard.type(prompt, { delay: 105 });
      await expect
        .poll(async () => (await clientTerminal(page)).text)
        .toContain(prompt);
      camera.checkpoint("typed", await clientTerminal(page));
      await page.screenshot({
        path: join(output, "01-ask.png"),
        scale: "device",
      });
    });
    await camera.scene("02-team", [], async () => {
      await page.keyboard.press("Enter");
      camera.checkpoint("sent");
      console.log("Request sent to real Claude Code");
      await expect
        .poll(async () => {
          const { children } = await app.request("teams.children", {
            cwd: demo.folder,
          });
          return children.find(
            (child) => child.role === "Worker" && child.terminalId,
          )?.id;
        })
        .toBeTruthy();
      camera.checkpoint("delegated", await clientTerminal(page));
      const { children } = await app.request("teams.children", {
        cwd: demo.folder,
      });
      assert.equal(
        children.some((child) => child.role === "Reviewer"),
        false,
      );
      const worker = children.find((child) => child.role === "Worker")!;
      await page.screenshot({
        path: join(output, "02-delegated.png"),
        scale: "device",
      });
      await writeFile(
        join(output, "worker.json"),
        JSON.stringify(worker, null, 2),
      );
    });
    const children = () => app.request("teams.children", { cwd: demo.folder });
    const openView = async (kind: string) => {
      const tab = page.locator(`button[data-iori-tab-kind="${kind}"]`);
      if (await tab.count()) await tab.click();
      else {
        await page
          .getByRole("button", { name: "New tab", exact: true })
          .first()
          .click();
        await page
          .locator(`[data-iori-action="workspace-open-${kind}"]`)
          .click();
      }
    };
    await camera.scene("03-board", [], async () => {
      const worker = (await children()).children.find(
        (child) => child.role === "Worker",
      )!;
      await expect
        .poll(() => readFile(join(demo.folder, "src/App.jsx"), "utf8"))
        .not.toBe(initialSource);
      await page
        .locator(`[data-iori-child-id="${worker.id}"]`)
        .getByRole("button")
        .first()
        .click();
      await expect(visibleTerminal(page)).toHaveAttribute(
        "data-iori-terminal-id",
        worker.terminalId!,
      );
      await expect
        .poll(async () => (await clientTerminal(page)).text.replace(/\s/gu, ""))
        .not.toMatch(
          /withyourfile-readingtool|openthefile|followthedelegatedrequest/iu,
        );
      camera.checkpoint("worker-visible", await clientTerminal(page));
      await page.screenshot({
        path: join(output, "03-worker.png"),
        scale: "device",
      });
      await expect
        .poll(async () =>
          (await children()).children.some(
            (child) =>
              child.role === "Worker" &&
              (child.state === "reported" || child.state === "finished"),
          ),
        )
        .toBe(true);
      camera.checkpoint("worker-reported", await clientTerminal(page));
      await page.screenshot({
        path: join(output, "03-worker-report.png"),
        scale: "device",
      });
      await writeFile(
        join(output, "worker-screen.json"),
        JSON.stringify(await clientTerminal(page), null, 2),
      );
      await camera.hold(2200);
    });
    await camera.scene("04-review", [], async () => {
      await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
      camera.checkpoint("worker-report");
      await page.screenshot({
        path: join(output, "04-worker-report.png"),
        scale: "device",
      });
      await expect
        .poll(
          async () =>
            (await children()).children.find(
              (child) => child.role === "Reviewer" && child.terminalId,
            )?.id,
        )
        .toBeTruthy();
      camera.checkpoint("reviewer-started", await clientTerminal(page));
      await page.screenshot({
        path: join(output, "04-reviewer-started.png"),
        scale: "device",
      });
      const reviewer = (await children()).children.find(
        (child) => child.role === "Reviewer",
      )!;
      await openView("git");
      await page.getByRole("button", { name: /App\.jsx/ }).click();
      await expect(page.locator('[data-iori-scroll="git-diff"]')).toContainText(
        "Settings",
      );
      camera.checkpoint("diff-open");
      await page.screenshot({
        path: join(output, "04-diff.png"),
        scale: "device",
      });
      const diff = (await page
        .locator('[data-iori-scroll="git-diff"]')
        .boundingBox())!;
      await page.mouse.move(diff.x + diff.width / 2, diff.y + diff.height / 2, {
        steps: 12,
      });
      await page.mouse.wheel(0, 200);
      await camera.hold(4000);
      await page
        .locator(`[data-iori-child-id="${reviewer.id}"]`)
        .getByRole("button")
        .first()
        .click();
      await expect(visibleTerminal(page)).toHaveAttribute(
        "data-iori-terminal-id",
        reviewer.terminalId!,
      );
      await expect
        .poll(async () => (await clientTerminal(page)).text)
        .toMatch(/\$|⎿|└|Read\(/u);
      await expect
        .poll(async () => (await clientTerminal(page)).text.replace(/\s/gu, ""))
        .not.toMatch(
          /withyourfile-readingtool|openthefile|followthedelegatedrequest/iu,
        );
      camera.checkpoint("reviewer-active", await clientTerminal(page));
      await expect
        .poll(async () =>
          (await children()).children.some(
            (child) =>
              child.role === "Reviewer" &&
              (child.state === "reported" || child.state === "finished"),
          ),
        )
        .toBe(true);
      camera.checkpoint("reviewer-reported", await clientTerminal(page));
      await page.screenshot({
        path: join(output, "04-reviewer-report.png"),
        scale: "device",
      });
      await writeFile(
        join(output, "reviewer-screen.json"),
        JSON.stringify(await clientTerminal(page), null, 2),
      );
      await camera.hold(2200);
      await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
      await expect
        .poll(async () => {
          const current = (await children()).children;
          return (
            current.length === 2 &&
            current.every(
              (child) =>
                child.state === "finished" && child.decision === "accept",
            )
          );
        })
        .toBe(true);
      camera.checkpoint("accepted", await clientTerminal(page));
      await page.screenshot({
        path: join(output, "04-accepted.png"),
        scale: "device",
      });
      await camera.hold(3600);
    });
    await camera.scene("05-complete", [], async () => {
      await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
      await expect
        .poll(async () => {
          const board = await app.request("teams.board", { cwd: demo.folder });
          const plan = board.conversations.find(
            (conversation) => conversation.terminalId === parent,
          )?.plan;
          return Boolean(
            plan?.tasks.length &&
            plan.tasks.every((task) => task.state === "done"),
          );
        })
        .toBe(true);
      camera.checkpoint("plan-complete");
      await page.screenshot({
        path: join(output, "05-complete.png"),
        scale: "device",
      });
      await page.mouse.move(1050, 650, { steps: 12 });
      await camera.hold(4000);
      await writeFile(
        join(output, "board.json"),
        JSON.stringify(
          await app.request("teams.board", { cwd: demo.folder }),
          null,
          2,
        ),
      );
    });
    await camera.scene("06-records", [], async () => {
      await page
        .getByRole("button", { name: "AI Agents/Teams", exact: true })
        .click();
      await page.getByRole("button", { name: "Records", exact: true }).click();
      await expect(
        page.getByRole("table", { name: "Worker", exact: true }),
      ).toContainText("100%");
      camera.checkpoint("records-open");
      await page.screenshot({
        path: join(output, "06-records.png"),
        scale: "device",
      });
      await page
        .getByRole("table", { name: "Reviewer", exact: true })
        .scrollIntoViewIfNeeded();
      await page.mouse.move(870, 460, { steps: 12 });
      await page.mouse.wheel(0, 110);
      await camera.hold(3000);
      await page
        .getByRole("table", { name: "Worker", exact: true })
        .scrollIntoViewIfNeeded();
      await camera.hold(3000);
      await writeFile(
        join(output, "records.json"),
        JSON.stringify(await app.request("teams.records", {}), null, 2),
      );
    });
    await mkdir(join(output, "sample"), { recursive: true });
    for (const file of [
      "src/App.jsx",
      "src/style.css",
      "package.json",
      "AGENTS.md",
    ]) {
      await mkdir(dirname(join(output, "sample", file)), { recursive: true });
      await writeFile(
        join(output, "sample", file),
        await readFile(join(demo.folder, file)),
      );
    }
    await writeFile(
      join(output, "children.json"),
      JSON.stringify(await children(), null, 2),
    );
    console.log(
      "Worker and Reviewer accepted; plan complete; real Records captured",
    );
  } finally {
    await finish();
  }
});
