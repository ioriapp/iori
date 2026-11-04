import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { openSettingsSection } from "../connection/scenario.mjs";

const sizes = {
  pc: { width: 1440, height: 1000 },
  wqhd: { width: 2560, height: 1440 },
  mobile: { width: 390, height: 844 },
};

/** Pictures of the AI agents screen for reviewing it. With
 * IORI_CLI_DEFINITION_CAPTURE=1 a state is taken at PC 1440, WQHD 2560 and
 * phone 390 in both themes; otherwise only the PC picture the run took. */
export function definitionPictures({ client, shot }) {
  const { screen } = client;
  const capturing = process.env.IORI_CLI_DEFINITION_CAPTURE === "1";
  const pictures = async (name, show, devices = Object.keys(sizes), before) => {
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const device of devices) {
      await before?.();
      await client.browser.viewport(sizes[device]);
      await show?.();
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        // Colors move with transitions; take the picture once they settle.
        await waitFor(() =>
          screen.evaluate(
            "document.getAnimations().every(a=>!(a instanceof CSSTransition)||a.playState!=='running')",
          ),
        );
        await shot(`${device}-${name}-${theme}`);
      }
    }
    await client.browser.viewport(sizes.pc);
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  /** The page scrolled to the top or the end of the CLI list. */
  const scroll = (to) =>
    screen.evaluate(`(()=>{
      let e=document.querySelector('.team-agents-page');
      while(e&&!(e.scrollHeight>e.clientHeight&&/(auto|scroll)/.test(getComputedStyle(e).overflowY)))e=e.parentElement;
      e??=document.scrollingElement;
      e.scrollTop=${to === "end" ? "e.scrollHeight" : "0"};
      return true;
    })()`);
  return {
    capturing,
    /** `show` brings the subject into view again at each width. */
    async capture(name, show, before) {
      if (!capturing) return shot(`cli-definition-${name}`);
      await pictures(`cli-definition-${name}`, show, undefined, before);
    },
    async launcher() {
      const show = async () => {
        const mobile = await screen.evaluate("innerWidth < 768");
        const popover = '.new-items-popover[data-state="open"]';
        const dialog = '[data-iori-view="shell-picker"][data-state="open"]';
        const target = mobile ? dialog : popover;
        if (await screen.visible(mobile ? popover : dialog))
          await screen.key("Escape");
        if (!(await screen.visible(target)))
          await screen.click('[data-iori-action="workspace-add-tab"]');
        await screen.wait(target);
      };
      await pictures("cli-definition-icons-launcher", show, ["pc", "mobile"]);
      // Crossing the mobile breakpoint closes the popover. Restore the
      // user's menu after restoring the desktop viewport as well.
      await show();
    },
    top: () => scroll("top"),
    end: () => scroll("end"),
    /** Rows of every kind: a bundled definition's CLI (a stand-in `qoder`
     * that prints its version), a user's override of a bundled definition,
     * a definition whose CLI this Host does not find, and one that cannot be
     * read. Returns what puts the Host back. */
    async arrangeRows(hostData) {
      const bin = join(homedir(), "capture-bin");
      await mkdir(bin, { recursive: true });
      await writeFile(
        join(bin, "qoder"),
        '#!/bin/sh\nif [ "$1" = --version ]; then echo 0.5.2; exit 0; fi\nexec sleep 3600\n',
        { mode: 0o700 },
      );
      await appendFile(
        join(homedir(), ".profile"),
        `export PATH='${bin}':"$PATH"\n`,
      );
      const codex = JSON.parse(
        await readFile(
          new URL(
            "../../apps/host/src/cli/codex/definition.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const folders = {
        codex: { ...codex, aliases: ["codex-dev"] },
        goose: {
          schema: 1,
          id: "goose",
          name: "Goose",
          command: "goose",
          version: { args: ["--version"] },
          models: { list: { args: ["models"], format: "lines" } },
          launch: { model: ["--model", "{model}"] },
          resume: { args: ["--resume", "{sessionId}"] },
        },
        crush: {
          schema: 1,
          id: "crush",
          name: "Crush",
          command: "crush",
          launch: { model: "--model {model}" },
        },
      };
      const root = join(hostData, "cli-definitions");
      for (const [id, value] of Object.entries(folders)) {
        await mkdir(join(root, id), { recursive: true });
        for (const name of Object.values(value.icon ?? {}))
          await copyFile(
            new URL(
              `../../apps/client/third-party/cli-icons/${name}`,
              import.meta.url,
            ),
            join(root, id, name),
          );
        await writeFile(
          join(root, id, "definition.json"),
          JSON.stringify(value, null, 2),
        );
      }
      return async () => {
        for (const id of Object.keys(folders))
          await rm(join(root, id), { recursive: true, force: true });
        await rm(bin, { recursive: true, force: true });
      };
    },
    /** The rows closed, as the list is first shown. */
    async closeRows() {
      const open = await screen.evaluate(
        "[...document.querySelectorAll('[data-iori-cli-row][data-state=\"open\"]')].map(e=>e.dataset.ioriCliRow)",
      );
      for (const id of open)
        await screen.click(`[data-iori-cli-row="${id}"] .team-agent-toggle`);
    },
    /** A file chosen with the file picker, as the user picks one. */
    async chooseFile(text) {
      await screen.evaluate(`(()=>{
        const input=document.querySelector('[data-iori-field="cli-definition-file"]');
        const data=new DataTransfer();
        data.items.add(new File([${JSON.stringify(text)}],"definition.json",{type:"application/json"}));
        input.files=data.files;
        input.dispatchEvent(new Event("change",{bubbles:true}));
        return true;
      })()`);
      await screen.wait(".cli-def-file-name");
    },
    /** The device's own revoke confirmation, whose wording changed with the
     * CLI definitions screen, at PC and phone width. */
    async revokeConfirmation() {
      await openSettingsSection(screen, "open-devices");
      await screen.click('[data-iori-action="revoke-device"]');
      await screen.wait('[data-iori-action="confirm-revoke"]');
      await pictures("revoke-confirmation", undefined, ["pc", "mobile"]);
      await screen.key("Escape");
      await screen.key("Escape");
    },
  };
}
