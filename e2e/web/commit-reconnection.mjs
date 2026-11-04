import { waitFor } from "../../verification/ui.mjs";

const action = (name) =>
  `[data-iori-view="git"] [data-iori-action=${JSON.stringify(name)}]`;

export async function commitReconnection({
  screen,
  commits,
  disconnectedReads,
  record,
}) {
  const list = async () => {
    if (await screen.visible(action("reading-back")))
      await screen.click(action("reading-back"));
  };
  await list();
  await screen.click(action("git-mode-history"));
  await screen.click(
    `${action("git-commit-select")}[data-hash=${JSON.stringify(commits.large)}]`,
  );
  await screen.wait(
    `${action("git-commit-file-select")}[data-path="commit-files/file-000.txt"]`,
  );
  await disconnectedReads(() =>
    screen.scroll('[data-iori-scroll="git-commit-files"]', { top: "end" }),
  );
  await screen.wait(
    `${action("git-commit-file-select")}[data-path="commit-files/file-159.txt"]`,
  );
  await record(
    "切断中にcommitの未読ページへ移動しても、再接続で変更したファイルの続きを読める",
  );

  await list();
  await disconnectedReads(() =>
    screen.click(
      `${action("git-commit-select")}[data-hash=${JSON.stringify(commits.initial)}]`,
    ),
  );
  await waitFor(
    async () =>
      (await screen.text(
        '[data-iori-part="commit-header"] .git-commit-title',
      )) === "Create browser fixture",
  );
  await screen.wait(
    `${action("git-commit-file-select")}[data-path="sample.txt"]`,
  );
  await record(
    "切断中に選んだcommitの本体とファイル一覧を、再接続で開き直さず読める",
  );
  await list();
  await screen.click(action("git-mode-changes"));
}
