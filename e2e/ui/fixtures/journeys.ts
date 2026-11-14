import { expect } from "./test.ts";
import type { App } from "./test.ts";
import type { Page } from "@playwright/test";

type Candidate = {
  id: string;
  cli: string;
  model: string;
  tools: string[];
  minimum: string;
};

export async function createTeam(
  app: App,
  options: {
    name: string;
    cli?: string;
    roles?: Array<{
      id?: string;
      name: string;
      reuse?: boolean;
      candidate?: Partial<Candidate>;
    }>;
    makeDefault?: boolean;
  },
): Promise<{ id: string }> {
  const baseCandidate: Candidate = {
    id: "scripted",
    cli: options.cli ?? app.cliId,
    model: "",
    tools: [],
    minimum: "",
  };
  const roles = (options.roles ?? [{ name: "Worker" }]).map((role) => ({
    id: role.id ?? role.name.toLowerCase(),
    name: role.name,
    when: "",
    limit: "",
    reuse: role.reuse ?? true,
    split: false,
    instruction: "",
    request: "",
    report: "",
    candidates: {
      high: [],
      medium: [{ ...baseCandidate, ...role.candidate }],
      low: [],
    },
  }));
  const { saved } = await app.request("teams.create", {
    definition: {
      name: options.name,
      description: "",
      instruction: "",
      parent: { ...baseCandidate, id: "parent" },
      roles,
    },
  });
  if (options.makeDefault ?? true) {
    await app.request("teams.settings", {
      enabled: true,
      defaultTeam: saved.id,
      limits: {},
    });
  }
  return { id: saved.id };
}

export async function sidebar(page: Page, mobile: boolean) {
  if (mobile)
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
}
export async function openPath(
  page: Page,
  path: string,
  hostKey: string,
  mobile = false,
) {
  await sidebar(page, mobile);
  const host = page.getByRole("listitem").filter({
    has: page.locator(`[data-iori-host-key="${hostKey}"][aria-expanded]`),
  });
  await host.getByRole("button", { name: "Add folder", exact: true }).click();
  const picker = page.locator('[data-iori-view="folder-picker"]');
  const input = picker.getByRole("combobox", {
    name: "Folder path",
    exact: true,
  });
  await expect(input).toHaveValue(/.+/);
  await input.fill(path);
  await picker.getByRole("button", { name: /^Open this folder/ }).click();
  await expect(
    page.locator("[data-iori-current-worktree-path]"),
  ).toHaveAttribute("data-iori-current-worktree-path", path);
  if (mobile)
    await expect(
      page.getByRole("button", { name: "New tab", exact: true }),
    ).toBeVisible();
}
export async function launch(page: Page, name: string) {
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name, exact: true })
    .click();
}
export async function hostSettings(
  page: Page,
  hostKey: string,
  action: string,
) {
  await page
    .locator(
      `[data-iori-action="host-settings-open"][data-iori-host-key="${hostKey}"]`,
    )
    .click();
  await page.locator(`[data-iori-action="${action}"]`).click();
}
