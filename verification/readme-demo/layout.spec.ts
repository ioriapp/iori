import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  test as base,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "../../e2e/ui/fixtures/test.ts";
import { createTeam, launch } from "../../e2e/ui/fixtures/journeys.ts";
import { splitBoard } from "./layout.mjs";
import { clientTerminal } from "./terminals.mjs";

const test = base.extend({
  hostEnvironment: async ({}, use) =>
    use({
      NODE_OPTIONS: `--import=${new URL("./hostname.mjs", import.meta.url).pathname}`,
    }),
});
const output = process.env.IORI_DEMO_OUTPUT!;

test("Layout reference: CLI beside the two-column Board, without models", async ({
  page,
  registeredApp: app,
}) => {
  await mkdir(output, { recursive: true });
  await createTeam(app, {
    name: "Web development",
    roles: [
      { name: "Worker", candidate: { id: "worker-candidate" } },
      { name: "Reviewer", candidate: { id: "reviewer-candidate" } },
    ],
  });
  await app.open(page);
  await openFolder(page, app);
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
  const box = (await resize.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(240, box.y + 80, { steps: 16 });
  await page.mouse.up();
  await launch(page, "Web development");
  const parent = await terminalId(visibleTerminal(page));
  await app.terminalText(parent, "ACTOR_PROMPT:");
  const command = async (terminal: string, id: string, command: string[]) => {
    await app.input(terminal, JSON.stringify({ id, command }) + "\r");
    await app.terminalText(
      terminal,
      new RegExp(`ACTOR_RESULT:${id}:.*"ok":true`),
    );
  };
  await command(parent, "goal", [
    "plan",
    "goal",
    "--body",
    "Add a dark mode toggle to settings. Have it reviewed.",
  ]);
  for (const title of [
    "Implement dark mode toggle",
    "Review the change",
    "Accept and finish",
  ])
    await command(parent, title.replaceAll(" ", "-"), [
      "plan",
      "add",
      "--title",
      title,
    ]);
  await command(parent, "working", [
    "plan",
    "update",
    "1",
    "--state",
    "in_progress",
  ]);
  await command(parent, "worker", [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "medium",
    "--title",
    "Add dark mode toggle",
    "--worktree",
    "parent",
    "--plan",
    "1",
    "--body",
    "Add a dark mode toggle to settings.",
  ]);
  const children = () => app.request("teams.children", { cwd: app.folder });
  await expect
    .poll(
      async () =>
        (await children()).children.find((c) => c.role === "Worker")
          ?.terminalId,
    )
    .toBeTruthy();
  const worker = (await children()).children.find((c) => c.role === "Worker")!;
  await page
    .locator(`[data-iori-child-id="${worker.id}"]`)
    .getByRole("button")
    .first()
    .click();
  await app.terminalText(worker.terminalId!, "ACTOR_PROMPT:");
  await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
  await splitBoard(page);
  await page.locator(`[data-iori-terminal-row="${parent}"]`).click();
  const { forbidden } = JSON.parse(
    await readFile(join(homedir(), ".config/iori/publish.json"), "utf8"),
  );
  const snapshots: unknown[] = [];
  const snapshot = async (name: string) => {
    const terminal = await clientTerminal(page);
    const text =
      (await page.locator("body").innerText()) + "\n" + terminal.text;
    const normalize = (s: string) => s.toLowerCase().replace(/\s/gu, "");
    expect(
      forbidden.some((v: string) => normalize(text).includes(normalize(v))),
    ).toBe(false);
    const board = page.locator('[data-iori-view="board"]');
    const columns = await page
      .locator(".board-grid")
      .evaluate((e) => getComputedStyle(e).gridTemplateColumns);
    expect(columns.split(" ").length).toBe(2);
    const path = join(output, name + ".png");
    await page.screenshot({ path, scale: "device" });
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      path,
      "-vf",
      "scale=880:-1",
      join(output, name + "-880.png"),
    ]);
    snapshots.push({
      name,
      viewport: page.viewportSize(),
      terminal,
      board: await board.boundingBox(),
      columns,
      privacy: { safe: true, forbiddenValues: forbidden.length },
    });
  };
  await snapshot("01-parent-1920");
  await page
    .locator(`[data-iori-child-id="${worker.id}"]`)
    .getByRole("button")
    .first()
    .click();
  await command(worker.terminalId!, "worker-report", [
    "report",
    "--body",
    "Added the dark mode toggle. Build passed.",
  ]);
  await snapshot("02-worker-1920");
  await writeFile(
    join(output, "layout.json"),
    JSON.stringify({ models: false, snapshots }, null, 2),
  );
});
