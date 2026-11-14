import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const surface = ".team-surface:not([hidden])";
const dialog = '[data-iori-view="team-save-conflict"]';
const name = `${surface} [data-iori-field="team-name"]`;

// A stale editor keeps its draft and resolves another Client's save or deletion.
export async function teamSaveConflictScenario({ client, phone, record }) {
  const screen = client.screen;
  const closed = () => waitFor(async () => !(await screen.visible(dialog)));
  const clickConflict = async (which) =>
    screen.click(`${dialog} ${action(`team-conflict-${which}`)}`);
  const other = await phone();
  await other.screen.wait('[data-iori-view="workspace"]');
  const request = (method, params) =>
    other.screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const response=await connection.requestHost(host,${JSON.stringify(method)},${JSON.stringify(params)});if(!response?.ok)throw new Error('Team request failed');return response.result;})()`,
    );
  const team = await request("teams.create", {
    template: "development",
    language: "ja",
  });
  let id = team.saved.id;
  const remoteSave = async (changes) => {
    const current = await request("teams.read", { teamId: id });
    return request("teams.save", {
      teamId: id,
      definition: { ...current.saved, ...changes },
      baseVersion: current.saved.version,
    });
  };
  await screen.click(action("open-agents-teams"));
  await screen.click(`${surface} ${action("teams-list")}`);
  await screen.click(`${surface} .team-list [data-iori-team-id="${id}"]`);
  await screen.input(name, "自分の編集（仮）");
  const latest = await remoteSave({ name: "別のデバイス（仮）" });
  await screen.click(action("team-save"));
  await screen.wait(dialog);
  assert.match(
    await screen.text(`${dialog} [data-slot="dialog-title"]`),
    /このTeamは別のデバイスで変更されました/,
  );
  assert.match(
    await screen.text(`${dialog} .page-description`),
    new RegExp(`バージョン${latest.saved.version} · .*名前を変更`),
  );
  assert.equal(
    await screen.evaluate(
      `document.activeElement?.getAttribute('data-iori-action')`,
    ),
    "team-conflict-cancel",
  );
  await clickConflict("cancel");
  await closed();
  assert.equal(await screen.value(name), "自分の編集（仮）");
  await screen.click(action("team-save"));
  const overwrite = await client.faults.holdResponse("teams.save");
  await clickConflict("overwrite");
  await screen.wait(
    `${dialog} ${action("team-conflict-overwrite")}[aria-busy="true"]`,
  );
  await overwrite.release();
  await waitFor(async () => !(await screen.visible(dialog)));
  assert.match(
    await screen.text(`${surface} .team-save-title .page-description`),
    /バージョン3 · 保存済み/,
  );
  await screen.click(action("team-history"));
  assert.match(
    await screen.text('[data-iori-history-version="3"]'),
    /バージョン2を上書き/,
  );
  await screen.key("Escape");
  await record(
    "保存の競合をキャンセルして編集を保持し、上書き後の履歴に相手のバージョンを表示",
  );
  const beforeLostResponse = await request("teams.read", { teamId: id });
  await screen.input(name, "応答を失った保存（仮）");
  await client.faults.dropResponse("teams.save");
  await screen.click(action("team-save"));
  await waitFor(
    () => screen.text(`${surface} .team-save-title .page-description`),
    (text) => text.includes("Teamを保存できませんでした。"),
  );
  await screen.click(action("team-save"));
  await waitFor(
    () => screen.text(`${surface} .team-save-title .page-description`),
    (text) =>
      text.includes(
        `バージョン${beforeLostResponse.saved.version + 1} · 保存しました`,
      ),
  );
  assert.equal(await screen.visible(dialog), false);
  const afterLostResponse = await request("teams.read", { teamId: id });
  assert.equal(
    afterLostResponse.saved.version,
    beforeLostResponse.saved.version + 1,
  );
  assert.equal(
    afterLostResponse.history.length,
    beforeLostResponse.history.length + 1,
  );
  await record(
    "保存の応答を失っても再試行で同じバージョンを保存済みとして表示",
  );
  await screen.input(name, "破棄する編集（仮）");
  await remoteSave({ name: "再読み込みの内容（仮）" });
  await screen.click(action("team-save"));
  await screen.click(`${dialog} ${action("team-conflict-reload")}`);
  await waitFor(
    () => screen.value(name),
    (value) => value === "再読み込みの内容（仮）",
  );
  await record("保存の競合から再読み込みすると別のデバイスの内容を表示");

  await screen.input(name, "再競合の編集（仮）");
  await remoteSave({ description: "先の変更（仮）" });
  await screen.click(action("team-save"));
  await screen.wait(dialog);
  const newer = await remoteSave({ description: "さらに保存した変更（仮）" });
  await clickConflict("overwrite");
  await waitFor(
    () => screen.text(`${dialog} .page-description`),
    (text) => text.includes(`バージョン${newer.saved.version} ·`),
  );
  const failed = await client.faults.fail("teams.save");
  await clickConflict("overwrite");
  await screen.wait(`${dialog} [role="alert"]`);
  assert.equal(
    await screen.text(`${dialog} [role="alert"]`),
    "Teamを保存できませんでした。もう一度お試しください。",
  );
  await failed.clear();
  await clickConflict("overwrite");
  await closed();
  await record(
    "再度の競合で要約を更新し、通信失敗から同じ上書きボタンで再試行",
  );

  await screen.input(name, "移動前の編集（仮）");
  await remoteSave({ description: "移動前に別のデバイスが保存（仮）" });
  await screen.click(`${surface} ${action("teams-list")}`);
  await screen.wait('[data-iori-view="team-save-confirmation"]');
  await screen.click(action("team-save-and-leave"));
  await screen.wait(dialog);
  assert.equal(
    await screen.visible('[data-iori-view="team-save-confirmation"]'),
    false,
  );
  await clickConflict("cancel");
  await closed();
  assert.equal(await screen.value(name), "移動前の編集（仮）");
  await screen.click(`${surface} ${action("teams-list")}`);
  await screen.click(action("team-save-and-leave"));
  await screen.wait(dialog);
  await clickConflict("reload");
  await closed();
  await screen.wait(`${surface} .team-list [data-iori-team-id="${id}"]`);
  await screen.click(`${surface} .team-list [data-iori-team-id="${id}"]`);
  await record(
    "離れるときの保存競合はキャンセルで移動せず、解決すると元の移動先へ進む",
  );

  await screen.input(name, "上書きして移動（仮）");
  await remoteSave({ description: "上書きで移動する前に保存（仮）" });
  await screen.click(`${surface} ${action("teams-list")}`);
  await screen.click(action("team-save-and-leave"));
  await screen.wait(dialog);
  await clickConflict("overwrite");
  await closed();
  await screen.wait(`${surface} .team-list [data-iori-team-id="${id}"]`);
  await screen.click(`${surface} .team-list [data-iori-team-id="${id}"]`);
  assert.equal(await screen.value(name), "上書きして移動（仮）");

  const beforeRemoval = await request("teams.read", { teamId: id });
  const removedRole = beforeRemoval.saved.roles[0];
  await screen.input(name, "長いTeam名（仮）".repeat(24));
  await screen.click(
    `${surface} ${action("team-role")}[data-iori-role-id="${removedRole.id}"]`,
  );
  await screen.input(name, "長い役割の名前（仮）".repeat(12));
  await remoteSave({ roles: beforeRemoval.saved.roles.slice(1) });
  await screen.click(action("team-save"));
  await screen.wait(dialog);
  await clickConflict("reload");
  await closed();
  await screen.wait(`${surface} .team-overview`);
  await screen.input(name, "新しいTeam（仮）");
  await request("teams.delete", { teamId: id });
  await screen.click(action("team-save"));
  await screen.wait(dialog);
  assert.match(
    await screen.text(`${dialog} [data-slot="dialog-title"]`),
    /このTeamは別のデバイスで削除されました/,
  );
  await clickConflict("cancel");
  await closed();
  assert.equal(await screen.value(name), "新しいTeam（仮）");
  await screen.click(action("team-save"));
  await screen.wait(dialog);
  await clickConflict("create");
  await waitFor(async () => !(await screen.visible(dialog)));
  assert.equal(await screen.value(name), "新しいTeam（仮）");
  assert.notEqual(
    await screen.attribute(
      `${surface} ${action("team-overview")}`,
      "data-iori-team-id",
    ),
    id,
  );
  await record("削除の競合から編集中の内容を新しいTeamとして保存");
  id = await screen.attribute(
    `${surface} ${action("team-overview")}`,
    "data-iori-team-id",
  );
  await screen.input(name, "破棄する編集（仮）");
  await request("teams.delete", { teamId: id });
  await screen.click(action("team-save"));
  await screen.wait(dialog);
  await clickConflict("discard");
  await closed();
  await screen.wait(`${surface} ${action("team-new")}`);
  assert.equal(
    await screen.visible(`${surface} .team-list [data-iori-team-id="${id}"]`),
    false,
  );
  await record("削除済みTeamの変更を破棄すると一覧から削除して一覧へ戻る");
}
