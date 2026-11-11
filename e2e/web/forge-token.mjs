import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { openFolder } from "../workspace/scenario.mjs";
import {
  closeSidebar,
  openSettingsSection,
  openSidebar,
} from "../connection/scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const row = (path) => `button[data-iori-worktree-path=${JSON.stringify(path)}]`;
const marks = (path) =>
  `${row(path)} ~ .nav-worktree-controls .nav-forge-marks`;
const site = (origin) => `[data-iori-forge-site=${JSON.stringify(origin)}]`;
const issuesButton = (path) =>
  `${action("repository-issues")}[data-iori-repository-path=${JSON.stringify(path)}]`;
const issuesPane = '[data-iori-view="issues"]:not([hidden])';
const ciPane = (path) =>
  `[data-iori-view="ci"][data-iori-ci-path=${JSON.stringify(path)}]`;
const tab = (kind) => `button[data-iori-tab-kind="${kind}"]`;
// The reason a Forge read failed, as the CI and Issues Views show it.
const forgeFailure = (view, reason) =>
  `${view} [data-iori-forge-failure="${reason}"]`;
const reasonText = (screen, failure) =>
  screen.text(`${failure} [data-iori-part="forge-failure"]`);

/**
 * Integrations: register, replace and remove a Forgejo token on the
 * disposable Forgejo (verification/forge), and read a private repository's
 * PR/CI marks, CI and Issues with it. A read the site refuses shows its
 * reason in the CI and Issues Views and leads back to Integrations. The
 * tokens are the throwaway site's own.
 */
export async function forgeTokenScenario({
  client,
  fixture,
  mobile,
  desktop,
  shot,
  record,
}) {
  const screen = client.screen;
  const forge = fixture;
  const siteRow = site(forge.origin);
  const state = (id) => `${siteRow} [data-iori-state="${id}"]`;
  const tokenField = `${siteRow} [data-iori-field="site-token"]`;
  const formError = `${siteRow} [data-iori-view="site-form"] [role="alert"]`;
  const capture = (name) => views(`integrations-${name}`);
  const views = async (name) => {
    if (process.env.IORI_FORGE_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const [device, width, height] of [
      ["pc", 1440, 1000],
      ["wqhd", 2560, 1440],
    ])
      for (const theme of ["light", "dark"]) {
        await client.browser.viewport({ width, height });
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`${device}-${name}-${theme}`);
      }
    await client.browser.viewport({ width: 1440, height: 1000 });
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  const tokenShown = (token) =>
    screen.evaluate(
      `document.body.innerHTML.includes(${JSON.stringify(token)})||[...document.querySelectorAll('input')].some(input=>input.value===${JSON.stringify(token)})`,
    );
  const openIntegrations = async () => {
    await openSettingsSection(screen, "open-integrations");
    await screen.wait(siteRow);
  };
  const openedUrl = async (selector) => {
    // Capture the ordinary external URL boundary, without leaving iori.
    await screen.evaluate(
      "window.__ioriOpenedUrls=[];window.open=(url)=>{window.__ioriOpenedUrls.push(url);return null;}",
    );
    await screen.click(selector);
    return waitFor(
      () => screen.evaluate("window.__ioriOpenedUrls[0]"),
      Boolean,
      undefined,
      "ブラウザーで開くURL",
    );
  };
  const ci = ciPane(forge.clonePath);

  await openSettingsSection(screen, "open-integrations");
  await screen.wait('[data-iori-state="no-forge-sites"]');
  await screen.wait('[data-iori-state="github-signed-out"]');
  await capture("empty");
  await screen.key("Escape");
  await openFolder(screen, forge.clonePath, false);
  await openIntegrations();
  await screen.wait('[data-iori-state="github-signed-out"]');
  await screen.wait(state("site-unregistered"));
  assert.equal(
    await screen.visible(`${marks(forge.clonePath)} [data-iori-forge]`),
    false,
    "tokenの無い非公開のリポジトリには印が出ない",
  );
  await capture("unregistered");
  await record(
    "連携に、開いたワークスペースのremoteから分かったForgejoのサイトが未登録で並ぶ",
  );

  // The sign-in-only site refuses the Issues without a token; the reason
  // leads to Integrations.
  await screen.key("Escape");
  await openSidebar(screen);
  await screen.click(issuesButton(forge.clonePath));
  const issuesMissing = forgeFailure(issuesPane, "token-missing");
  await screen.wait(issuesMissing);
  assert.equal(
    await reasonText(screen, issuesMissing),
    `${forge.origin}のトークンが登録されていません。`,
  );
  await views("issues-token-missing");
  await screen.click(`${issuesMissing} ${action("forge-open-integrations")}`);
  await screen.wait(state("site-unregistered"));
  await record(
    "tokenの無いサインイン必須のサイトでは、Issuesにtokenが無いことと「連携を開く」が出て、連携の行へ移れる",
  );

  await screen.click(`${siteRow} ${action("site-register-token")}`);
  await screen.wait(`${siteRow} [data-iori-state="site-token-note"]`);
  assert.equal(
    await screen.text(`${siteRow} [data-iori-view="site-form"] label`),
    "トークン",
  );
  await screen.input(tokenField, forge.unknownToken);
  await screen.key("Enter");
  await screen.wait(formError);
  assert.equal(await screen.value(tokenField), forge.unknownToken);
  await screen.wait(state("site-unregistered"));
  await capture("token-rejected");
  await record("サイトが受け付けないtokenは保存されず、理由が出て入力が残る");

  await screen.input(tokenField, forge.readToken);
  await screen.click(`${siteRow} ${action("site-token-save")}`);
  await screen.wait(state("site-registered"));
  assert.equal(
    await screen.text(state("site-registered")),
    `${forge.owner}として登録済み`,
  );
  assert.equal(await screen.visible(tokenField), false);
  assert.equal(await tokenShown(forge.readToken), false);
  await capture("registered");
  await screen.key("Escape");
  await openSidebar(screen);
  await screen.reveal(row(forge.clonePath));
  await screen.wait(
    `${marks(forge.clonePath)} [data-iori-forge="ci"][aria-label="CI失敗"]`,
  );
  await screen.wait(
    `${marks(forge.clonePath)} [data-iori-forge="pull-request"][aria-label=${JSON.stringify(`PR #${forge.pullNumber} Open`)}]`,
  );
  await screen.click(`${marks(forge.clonePath)} [data-iori-forge="ci"]`);
  await screen.wait(
    `${ci} [data-iori-ci-id="status:ci/test"][data-iori-ci-status="failed"]`,
  );
  assert.equal(
    await openedUrl(`${ci} ${action("ci-open-browser")}`),
    forge.checkUrl,
  );
  await views("ci-status-only");
  if (process.env.IORI_FORGE_CAPTURE === "1") {
    // A result still running, only for the pictures.
    await forge.status(forge.sha, "pending", "ci/deploy");
    // The pictures just resized the page: press once it is laid out again.
    await screen.click(`${ci} ${action("ci-reload")}`, { scroll: false });
    await screen.wait(
      `${ci} [data-iori-ci-id="status:ci/deploy"][data-iori-ci-status="pending"]`,
    );
    await views("ci-running");
  }
  // The Issues tab reads again when shown: the private repository's Issue.
  await screen.click(tab("issues"));
  await screen.wait(`${issuesPane} [data-iori-issue="${forge.issueNumber}"]`);
  // An Issue removed on the site while it is read: the repository still
  // reads, so the Issue says it is gone instead of a repository's failure.
  const goneDetail = `${issuesPane} [data-iori-part="issue-detail"][data-iori-issue-detail="${forge.goneIssueNumber}"]`;
  await screen.click(
    `${issuesPane} [data-iori-issue="${forge.goneIssueNumber}"]`,
  );
  await screen.wait(`${goneDetail} [data-iori-part="issue-posts"]`);
  await forge.deleteIssue(forge.goneIssueNumber);
  await screen.click(`${issuesPane} ${action("issues-reload")}`);
  await screen.wait(`${goneDetail} [data-iori-state="issue-gone"]`);
  assert.equal(
    await screen.visible(`${issuesPane} [data-iori-state="issues-failure"]`),
    false,
  );
  await record(
    "tokenを登録すると、非公開のリポジトリのPRとCIのアイコンが出て、CIのアイコンのCIのタブとIssuesのタブもそのtokenで読め、サイトで消したIssueは詳細でそのIssueが見つからないことを示す",
  );

  // The site revokes the token; the next read after a push shows it.
  await forge.revoke(forge.readTokenName);
  await forge.commit();
  await forge.fetch();
  // The CI tab reads again when shown, and leads to Integrations.
  await screen.click(tab("ci"));
  const ciInvalid = forgeFailure(ci, "token-invalid");
  await screen.wait(ciInvalid);
  assert.equal(
    await reasonText(screen, ciInvalid),
    `${forge.origin}のトークンが無効です。`,
  );
  await views("ci-token-invalid");
  await screen.click(`${ciInvalid} ${action("forge-open-integrations")}`);
  await screen.wait(siteRow);
  await screen.wait(state("site-token-invalid"));
  await capture("token-invalid");
  await screen.click(`${siteRow} ${action("site-replace-token")}`);
  await screen.input(tokenField, forge.noRepositoryToken);
  await screen.key("Enter");
  await screen.wait(state("site-insufficient-scope"));
  assert.equal(
    await screen.text(state("site-insufficient-scope")),
    "トークンにread:repositoryの権限がありません",
  );
  await capture("insufficient-scope");
  await record(
    "read:repositoryの無いtokenは、印を読めなかった時に連携の行で足りない権限が示される",
  );
  await screen.key("Escape");
  await screen.click(tab("issues"));
  const issuesScope = forgeFailure(issuesPane, "insufficient-scope");
  await screen.wait(issuesScope);
  assert.equal(
    await reasonText(screen, issuesScope),
    "トークンにread:repositoryの権限がありません。",
  );
  await views("issues-insufficient-scope");
  await screen.click(`${issuesScope} ${action("forge-open-integrations")}`);
  await screen.wait(state("site-insufficient-scope"));
  await record("Issuesも足りない権限を示し、「連携を開く」でその行へ移れる");
  await screen.click(`${siteRow} ${action("site-replace-token")}`);
  await screen.input(tokenField, forge.otherReadToken);
  await screen.key("Enter");
  await screen.wait(state("site-registered"));
  assert.equal(await tokenShown(forge.otherReadToken), false);
  await record(
    "サイトで取り消したtokenは、次に読んだ時に連携の行で無効と示され、tokenを替えると戻る",
  );
  // The Issues tab showing the failure reads again once the token changes.
  await screen.key("Escape");
  await waitFor(
    () => screen.visible(issuesScope),
    (shown) => !shown,
    undefined,
    "tokenを替えた後のIssuesの読み直し",
  );
  await screen.wait(issuesPane);
  await record(
    "Issuesの読めない理由は、tokenを替えると再読み込みを押さずに消える",
  );
  await openIntegrations();

  // The site stops answering: the next read shows it; 再試行 asks again.
  const next = "refs/iori-verification/next";
  await forge.commit();
  await forge.fetchInto(next);
  await forge.stop();
  execFileSync("git", [
    "-C",
    forge.clonePath,
    "update-ref",
    `refs/remotes/origin/${forge.branch}`,
    next,
  ]);
  await screen.wait(state("site-unreachable"));
  await screen.click(`${siteRow} ${action("site-retry")}`);
  await screen.wait(`${siteRow} ${action("site-retry")}:not([aria-busy])`);
  await screen.wait(state("site-unreachable"));
  await capture("unreachable");
  await forge.start();
  await screen.click(`${siteRow} ${action("site-retry")}`);
  await screen.wait(state("site-registered"));
  await record(
    "つながらないサイトは連携の行に時刻と再試行が出て、つながった後の再試行で戻る",
  );
  // The CI tab reads when shown: the same reason, and 再試行 reads again.
  await forge.stop();
  await screen.key("Escape");
  await screen.click(tab("ci"));
  const ciUnreachable = forgeFailure(ci, "unreachable");
  await screen.wait(ciUnreachable);
  assert.equal(
    await reasonText(screen, ciUnreachable),
    `${forge.origin}に接続できません。`,
  );
  await views("ci-unreachable");
  // Only the CI tab read the site meanwhile: its read is the row's too.
  await openIntegrations();
  await screen.wait(state("site-unreachable"));
  await screen.key("Escape");
  await forge.start();
  await screen.click(`${ciUnreachable} ${action("ci-retry")}`);
  await waitFor(
    () => screen.visible(ciUnreachable),
    (shown) => !shown,
    undefined,
    "つながった後のCIの再試行",
  );
  await openIntegrations();
  await screen.wait(state("site-registered"));
  await record(
    "CIのタブもつながらないことと再試行を示し、その間は連携の行もつながらないと示され、つながった後はCIの再試行で読め、連携の行も戻る",
  );

  await screen.click(`${siteRow} ${action("site-remove")}`);
  await screen.wait('[data-iori-view="site-remove-confirmation"]');
  assert.equal(
    await screen.text('[data-iori-view="site-remove-confirmation"] p'),
    `このHostから${forge.origin}のトークンを削除します。非公開のリポジトリとIssueは表示できなくなります。トークン自体は、サイトで無効にするまで使用できます。`,
  );
  await capture("remove-confirmation");
  await screen.click(action("site-remove-confirm"));
  await screen.wait(state("site-unregistered"));
  await screen.key("Escape");
  await openSidebar(screen);
  await waitFor(
    () => screen.visible(`${marks(forge.clonePath)} [data-iori-forge]`),
    (visible) => !visible,
  );
  await screen.click(`${ci} ${action("ci-reload")}`);
  await screen.wait(forgeFailure(ci, "token-missing"));
  await record(
    "tokenを削除すると未登録に戻り、非公開のリポジトリの印が消え、CIのタブにtokenが無いことが出る",
  );

  await openIntegrations();
  await screen.click(action("site-add"));
  await screen.input('[data-iori-field="site-url"]', "http://127.0.0.1:1");
  await screen.input(
    '[data-iori-view="site-form"] [data-iori-field="site-token"]',
    forge.readToken,
  );
  await screen.click(action("site-add-save"));
  await screen.wait('[data-iori-view="site-form"] [role="alert"]');
  assert.equal(
    await screen.text('[data-iori-view="site-form"] [role="alert"]'),
    "サイトに接続できませんでした。",
  );
  await capture("add-unreachable");
  // An unrecognized site keeps the form open and shows the reason.
  const notForge = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  await new Promise((resolve) => notForge.listen(0, "127.0.0.1", resolve));
  try {
    await screen.input(
      '[data-iori-field="site-url"]',
      `http://127.0.0.1:${notForge.address().port}`,
    );
    await screen.click(action("site-add-save"));
    await waitFor(
      () => screen.text('[data-iori-view="site-form"] [role="alert"]'),
      (text) =>
        text ===
        "ForgejoまたはGiteaのサイトとして認識できませんでした。URLを確認してください。",
      undefined,
      "Forgejo・Giteaとして応答しないサイトの理由",
    );
  } finally {
    notForge.closeAllConnections();
    await new Promise((resolve) => notForge.close(resolve));
  }
  await screen.input(
    '[data-iori-field="site-url"]',
    `${forge.origin}/${forge.owner}/${forge.repository}`,
  );
  await screen.input(
    '[data-iori-view="site-form"] [data-iori-field="site-token"]',
    forge.otherReadToken,
  );
  await screen.key("Enter");
  await screen.wait(state("site-registered"));
  assert.equal(await screen.visible('[data-iori-view="site-form"]'), false);
  await record(
    "サイトを追加では、つながらないURL・Forgejo・Giteaでないサイトの理由が出て、正しいURLとtokenで登録できる",
  );
  // The CI tab showing the failure reads again once a token is registered;
  // its commit has no CI, so the sidebar mark does not change meanwhile.
  await screen.key("Escape");
  await waitFor(
    () => screen.visible(forgeFailure(ci, "token-missing")),
    (shown) => !shown,
    undefined,
    "tokenを登録した後のCIの読み直し",
  );
  await screen.wait(`${ci} [data-iori-state="ci-none"]`);
  await record(
    "CIの読めない理由は、tokenを登録すると再読み込みを押さずに消える",
  );
  await openIntegrations();

  // A repository the site does not have leads to the workspace's settings.
  const missing = join(dirname(forge.clonePath), "missing-repository");
  const missingName = `${forge.owner}/missing-repo`;
  execFileSync("git", ["init", "--quiet", missing]);
  execFileSync("git", [
    "-C",
    missing,
    "-c",
    "user.name=iori E2E",
    "-c",
    "user.email=e2e@iori.invalid",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "init",
  ]);
  execFileSync("git", [
    "-C",
    missing,
    "remote",
    "add",
    "origin",
    `${forge.origin}/${missingName}.git`,
  ]);
  await screen.key("Escape");
  await openFolder(screen, missing, false);
  await openSidebar(screen);
  await screen.click(issuesButton(missing));
  const notFound = forgeFailure(issuesPane, "not-found");
  await screen.wait(notFound);
  assert.equal(
    await reasonText(screen, notFound),
    `リポジトリ${missingName}が見つかりません。`,
  );
  await views("issues-not-found");
  // The pictures just resized the page: press once it is laid out again.
  await screen.click(`${notFound} ${action("forge-open-workspace-settings")}`, {
    scroll: false,
  });
  await screen.wait(
    `[data-iori-view="repository-git-settings"][data-iori-repository-path=${JSON.stringify(missing)}]`,
  );
  await record(
    "サイトに無いリポジトリは、Issuesに見つからないことと「ワークスペースの設定を開く」が出て、そのワークスペースのGitの設定へ移れる",
  );

  if (process.env.IORI_FORGE_CAPTURE === "1") {
    await screen.key("Escape");
    // A commit whose only CI runs: the mark beside the repository's Issues button.
    const running = await forge.commit();
    await forge.status(running, "pending", "ci/build");
    await forge.fetch();
    await openSidebar(screen);
    await screen.reveal(row(forge.clonePath));
    await screen.wait(
      `${marks(forge.clonePath)} [data-iori-forge="ci"][aria-label="CI実行中"]`,
    );
    await views("sidebar-ci-running");
    await mobile({ width: 390, height: 844 });
    await openSidebar(screen);
    await screen.reveal(row(forge.clonePath));
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`phone-sidebar-ci-running-${theme}`);
    }
    await closeSidebar(screen);
    await openIntegrations();
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await shot(`phone-integrations-registered-${theme}`);
    }
    await screen.click(action("site-add"));
    await screen.input('[data-iori-field="site-url"]', "http://127.0.0.1:1");
    await screen.input(
      '[data-iori-view="site-form"] [data-iori-field="site-token"]',
      forge.readToken,
    );
    await screen.click(action("site-add-save"));
    await screen.wait('[data-iori-view="site-form"] [role="alert"]');
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      await screen.reveal('[data-iori-view="github-settings"]');
      await shot(`phone-integrations-add-top-${theme}`);
      await screen.reveal(action("site-add-save"));
      await shot(`phone-integrations-add-bottom-${theme}`);
      // The end of the form, read by scrolling the settings to the bottom.
      await screen.scroll(".settings-mobile-detail .settings-content", {
        top: 100000,
      });
      await shot(`phone-integrations-end-${theme}`);
    }
    await desktop();
  }
}
