import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

export async function saveOpenTerminalTails(page, dataRoot, evidence) {
  const open = await page.evaluate(`(() => {
    const tails = window.__terminalObservation?.tails ?? {};
    return [...document.querySelectorAll('[data-iori-tab-id^="terminal:"]')].map(tab => {
      const id = tab.getAttribute('data-iori-tab-id').slice('terminal:'.length);
      const pane = [...document.querySelectorAll('[data-iori-terminal-id]')].find(element => element.getAttribute('data-iori-terminal-id') === id);
      return { id, tail: tails[pane?.getAttribute('data-iori-stream-id')] ?? '' };
    });
  })()`);
  const database = new DatabaseSync(join(dataRoot, "iori-host/host.sqlite"), {
    readOnly: true,
  });
  try {
    const checkpoint = database.prepare(
      "SELECT snapshot_json FROM terminals WHERE id = ?",
    );
    const terminals = open.map(({ id, tail }) => {
      const snapshot = JSON.parse(checkpoint.get(id)?.snapshot_json ?? "null");
      const text =
        tail ||
        [snapshot?.scrollbackAnsi, snapshot?.snapshotAnsi]
          .filter(Boolean)
          .join("\n");
      return {
        id,
        source: tail ? "client stream" : "Host screen checkpoint",
        tail: stripVTControlCharacters(text)
          .replace(/iori:\/\/\S+|[a-zA-Z0-9_-]{64,}/g, "[redacted]")
          .slice(-65536),
      };
    });
    await writeFile(
      join(evidence, "terminal-tails.json"),
      JSON.stringify({ terminals }, null, 2) + "\n",
    );
  } finally {
    database.close();
  }
}

// Failure diagnostics only: include child tabs hidden behind the parent tab.
// Read the Host's most recent checkpoint, never credentials or the whole DB.
export async function saveOpenChildScreens(page, dataRoot, evidence) {
  const open = new Set(
    await page.evaluate(
      `[...document.querySelectorAll('[data-iori-tab-id^="terminal:"]')].map(tab => tab.getAttribute('data-iori-tab-id').slice('terminal:'.length))`,
    ),
  );
  const database = new DatabaseSync(join(dataRoot, "iori-host/host.sqlite"), {
    readOnly: true,
  });
  try {
    const screens = database
      .prepare(
        `SELECT child.value_json, terminal.snapshot_json, cli.value
         FROM team_children AS child
         JOIN terminals AS terminal ON terminal.id = json_extract(child.value_json, '$.terminalId')
         LEFT JOIN terminal_clis AS cli ON cli.terminal_id = terminal.id`,
      )
      .all()
      .flatMap((row) => {
        const child = JSON.parse(row.value_json);
        if (!open.has(child.terminalId)) return [];
        const snapshot = JSON.parse(row.snapshot_json ?? "null");
        const cli = JSON.parse(row.value ?? "null");
        return [
          {
            child: child.id,
            title: child.title,
            state: child.state,
            terminalId: child.terminalId,
            observed: cli?.observed ?? false,
            hasSession: Boolean(cli?.session),
            cliReady: cli?.runtime?.ready ?? false,
            cliState: cli?.runtime?.status?.state,
            pendingLines: cli?.runtime?.pendingLines?.length ?? 0,
            screen: stripVTControlCharacters(
              [snapshot?.scrollbackAnsi, snapshot?.snapshotAnsi]
                .filter(Boolean)
                .join("\n"),
            ).replace(/iori:\/\/\S+|[a-zA-Z0-9_-]{64,}/g, "[redacted]"),
          },
        ];
      });
    await writeFile(
      join(evidence, "failure-child-screens.json"),
      JSON.stringify({ source: "Host screen checkpoint", screens }, null, 2) +
        "\n",
    );
  } finally {
    database.close();
  }
}
