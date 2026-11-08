import { prepareTeamScenario, delegationUserRequest } from "./team-fixture.mjs";
import { teamNotice } from "../../packages/protocol/src/team-text.ts";
import { waitFor } from "../../verification/ui.mjs";
import {
  waitForOperation,
  childFailure,
} from "../../verification/web/operation.mjs";
export async function teamCommandRouteScenario(options) {
  const { parentInput, savedTeam, teamRecords, teamDelivery, record } =
    await prepareTeamScenario({ ...options, workflow: "team-command-route" });
  await parentInput.paste(delegationUserRequest);
  const probeRole = savedTeam.roles.find((entry) => entry.name === "Probe").id;
  const probeState = await waitForOperation(
    "チーム: 親の実delegateで確認用の子が報告",
    teamRecords,
    (value) =>
      value.children.some(
        (entry) => entry.roleId === probeRole && entry.reportFiles.length > 0,
      ),
    childFailure(teamRecords, (children) =>
      children.find((entry) => entry.roleId === probeRole),
    ),
  );
  const probe = probeState.children.find((entry) => entry.roleId === probeRole);
  await waitFor(
    () =>
      teamDelivery({
        line: teamNotice(probe.roleName, probe.title, "reported"),
        since: probe.createdAt,
      }),
    (value) => value.claude.noticeReceived,
    120000,
    "確認用の子の報告が通常の親の実入力に届く",
  );
  await record("通常の親の実delegateと確認用の子の報告通知を実入力で確認");
}
