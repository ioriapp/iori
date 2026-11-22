import {
  nameOrder,
  type Team,
  type TeamDefinition,
  type TeamRecord,
  type TeamSettings,
  type TeamMethod,
  type TeamParamsByMethod,
  type TeamResultByMethod,
  type Response,
} from "@iori/protocol";
import { randomUUID } from "node:crypto";
import { cliDefinitions } from "../cli/definitions.ts";
import type {
  TeamChild,
  TeamConversation,
  TeamTask,
} from "../teams/records.ts";
import { teamChanges } from "../team-changes.ts";
import { englishTemplates, templates } from "../team-templates.ts";
import {
  type Connection,
  type StoreContext,
  succeeded,
  failure,
} from "./connection.ts";

type TeamRow = {
  id: string;
  definition_json: string;
  version: number;
  updated: string;
  hidden: number;
};
type VersionRow = {
  value_json: string;
};
function teamRecord(
  row: TeamRow,
  versions: VersionRow[],
): TeamRecord & { hidden: boolean } {
  return {
    hidden: row.hidden === 1,
    saved: {
      ...(JSON.parse(row.definition_json) as TeamDefinition),
      id: row.id,
      version: row.version,
      updated: row.updated,
    },
    history: versions.map((version) => JSON.parse(version.value_json)),
  };
}

export function createTeamsRepository({
  database,
  transaction,
  terminalOperationResult,
  saveTerminalOperationResult,
}: Connection) {
  function teamConversations(): TeamConversation[] {
    return (
      database.prepare("SELECT value_json FROM team_conversations").all() as {
        value_json: string;
      }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  function teamTasks(): TeamTask[] {
    return (
      database.prepare("SELECT value_json FROM team_tasks").all() as {
        value_json: string;
      }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  function teamChildren(): TeamChild[] {
    return (
      database.prepare("SELECT value_json FROM team_children").all() as {
        value_json: string;
      }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  function putTeamConversation(value: TeamConversation): void {
    database
      .prepare("INSERT OR REPLACE INTO team_conversations VALUES (?, ?)")
      .run(value.id, JSON.stringify(value));
  }
  function putTeamTask(value: TeamTask): void {
    database
      .prepare("INSERT OR REPLACE INTO team_tasks VALUES (?, ?)")
      .run(value.id, JSON.stringify(value));
  }
  function putTeamChild(value: TeamChild): void {
    database
      .prepare("INSERT OR REPLACE INTO team_children VALUES (?, ?)")
      .run(value.id, JSON.stringify(value));
  }

  function teamSettings(): TeamSettings {
    const row = database
      .prepare("SELECT value_json FROM team_settings WHERE singleton = 1")
      .get() as { value_json: string } | undefined;
    if (!row) return { defaultTeam: "", limits: {} };
    // Older rows also hold `enabled`, which is no longer used.
    const { defaultTeam, limits } = JSON.parse(row.value_json) as TeamSettings;
    return { defaultTeam, limits };
  }
  function saveTeamSettings(settings: TeamSettings): void {
    database
      .prepare(
        "INSERT OR REPLACE INTO team_settings(singleton, value_json) VALUES (1, ?)",
      )
      .run(
        JSON.stringify({
          defaultTeam: settings.defaultTeam,
          limits: settings.limits,
        }),
      );
  }
  function readTeam(
    id: string,
  ): (TeamRecord & { hidden: boolean }) | undefined {
    const row = database
      .prepare(
        "SELECT id, definition_json, version, updated, hidden FROM teams WHERE id = ?",
      )
      .get(id) as TeamRow | undefined;
    if (!row) return undefined;
    const versions = database
      .prepare(
        "SELECT value_json FROM team_versions WHERE team_id = ? ORDER BY version DESC",
      )
      .all(id) as VersionRow[];
    return teamRecord(row, versions);
  }
  function listTeams(): TeamResultByMethod["teams.list"] {
    const rows = database
      .prepare(
        "SELECT id, definition_json, version, updated, hidden FROM teams",
      )
      .all() as TeamRow[];
    const versions = database
      .prepare(
        "SELECT team_id, value_json FROM team_versions ORDER BY team_id, version DESC",
      )
      .all() as (VersionRow & { team_id: string })[];
    const history = Map.groupBy(versions, (row) => row.team_id);
    const conversations = database
      .prepare(
        `SELECT json_extract(c.value_json, '$.teamId') AS teamId, COUNT(*) AS count
         FROM team_conversations c
         JOIN terminals t ON t.id = json_extract(c.value_json, '$.terminalId')
         GROUP BY teamId`,
      )
      .all() as { teamId: string; count: number }[];
    const counts = new Map(
      conversations.map(({ teamId, count }) => [teamId, count]),
    );
    const teams = rows
      .map((row) => ({
        ...teamRecord(row, history.get(row.id) ?? []),
        conversationCount: counts.get(row.id) ?? 0,
      }))
      .sort((a, b) => nameOrder(a.saved, b.saved));
    return {
      ...teamSettings(),
      teams,
      templates,
      usageClis: cliDefinitions
        .filter((cli) => cli.supportsUsage)
        .map((cli) => cli.id),
      cliNames: Object.fromEntries([
        ...cliDefinitions.map((cli) => [cli.id, cli.name]),
        ...teams
          .flatMap((record) => [
            ...record.history.map((entry) => entry.team),
            record.saved,
          ])
          .flatMap((team) => [
            team.parent,
            ...team.roles.flatMap((role) =>
              Object.values(role.candidates).flat(),
            ),
          ])
          .filter((candidate) => candidate.cliName)
          .map((candidate) => [candidate.cli, candidate.cliName!]),
      ]),
    };
  }
  /** Synchronous SQLite transaction owns definitions, history and operation result together. */
  function teamOperation<M extends Exclude<TeamMethod, "cli.models">>(
    context: StoreContext,
    method: M,
    params: TeamParamsByMethod[M],
  ): Response<TeamResultByMethod[M]> {
    if (method === "teams.list")
      return succeeded(listTeams()) as Response<TeamResultByMethod[M]>;
    const p = params as TeamParamsByMethod["teams.save"] &
      TeamParamsByMethod["teams.memo"] &
      TeamParamsByMethod["teams.create"] &
      TeamParamsByMethod["teams.hidden.set"] &
      TeamSettings;
    if (method === "teams.read") {
      const team = readTeam(p.teamId);
      return team
        ? (succeeded(team) as Response<TeamResultByMethod[M]>)
        : failure("invalid_request");
    }
    const previous = terminalOperationResult<TeamResultByMethod[M]>(context);
    if (previous) return succeeded(previous);
    return transaction(() => {
      let result: unknown;
      if (method === "teams.settings") {
        const settings = params as TeamSettings;
        result = {
          defaultTeam:
            settings.defaultTeam &&
            readTeam(settings.defaultTeam) &&
            !readTeam(settings.defaultTeam)!.hidden
              ? settings.defaultTeam
              : "",
          limits: settings.limits,
        };
        saveTeamSettings(result as TeamSettings);
      } else if (method === "teams.create" || method === "teams.duplicate") {
        const definition =
          method === "teams.duplicate"
            ? readTeam(p.teamId)?.saved
            : (p.definition ??
              (p.template
                ? (p.language === "en" ? englishTemplates : templates)[
                    p.template
                  ]
                : readTeam(p.sourceId!)?.saved));
        if (!definition) return failure("invalid_request");
        const fresh = structuredClone(definition);
        if (p.name !== undefined) fresh.name = p.name;
        if (
          method === "teams.create" &&
          p.template &&
          !p.sourceId &&
          !p.definition &&
          p.parent
        )
          fresh.parent = { ...p.parent, minimum: "" };
        fresh.parent.id = randomUUID();
        for (const role of fresh.roles) {
          role.id = randomUUID();
          for (const candidate of Object.values(role.candidates).flat())
            candidate.id = randomUUID();
        }
        result = writeTeam(randomUUID(), fresh);
      } else {
        const record = readTeam(p.teamId);
        if (!record) {
          if (method === "teams.save" && p.baseVersion !== undefined)
            result = { conflict: "deleted" };
          else return failure("invalid_request");
        } else if (
          method === "teams.save" &&
          p.baseVersion !== undefined &&
          p.baseVersion !== record.saved.version
        ) {
          result = { conflict: "changed", current: record };
        } else if (method === "teams.hidden.set") {
          database
            .prepare("UPDATE teams SET hidden = ? WHERE id = ?")
            .run(p.hidden ? 1 : 0, p.teamId);
          const settings = teamSettings();
          if (p.hidden && settings.defaultTeam === p.teamId)
            saveTeamSettings({ ...settings, defaultTeam: "" });
          result = { teamId: p.teamId, hidden: p.hidden };
        } else if (method === "teams.save")
          result = writeTeam(
            p.teamId,
            p.definition,
            record,
            undefined,
            p.editedFrom,
          );
        else if (method === "teams.delete") {
          database.prepare("DELETE FROM teams WHERE id = ?").run(p.teamId);
          const settings = teamSettings();
          if (settings.defaultTeam === p.teamId)
            saveTeamSettings({ ...settings, defaultTeam: "" });
          result = { teamId: p.teamId };
        } else {
          const entry = record.history.find(
            (h) => h.team.version === p.version,
          );
          if (!entry) return failure("invalid_request");
          if (method === "teams.restore")
            result = writeTeam(p.teamId, entry.team, record, p.version);
          else {
            entry.memo = p.memo;
            database
              .prepare(
                "UPDATE team_versions SET value_json = ? WHERE team_id = ? AND version = ?",
              )
              .run(JSON.stringify(entry), p.teamId, p.version);
            result = readTeam(p.teamId);
          }
        }
      }
      saveTerminalOperationResult(context, result);
      return succeeded(result as TeamResultByMethod[M]);
    });
  }
  function writeTeam(
    id: string,
    definition: TeamDefinition,
    before?: TeamRecord,
    restoredFrom?: number,
    editedFrom?: number,
  ): TeamRecord {
    const {
      name,
      description,
      parent,
      instruction,
      roles,
      parentInput,
      checkMinutes,
      backgroundWakeMinutes,
    } = definition;
    const clean = structuredClone({
      name,
      description,
      parent,
      instruction,
      roles,
      ...(parentInput ? { parentInput } : {}),
      ...(checkMinutes ? { checkMinutes } : {}),
      ...(backgroundWakeMinutes !== undefined ? { backgroundWakeMinutes } : {}),
    });
    const names = new Map([
      ...cliDefinitions.map((cli) => [cli.id, cli.name] as const),
    ]);
    for (const candidate of [
      clean.parent,
      ...clean.roles.flatMap((role) => Object.values(role.candidates).flat()),
    ]) {
      const cliName = names.get(candidate.cli);
      if (cliName) candidate.cliName = cliName;
    }
    const team: Team = {
      ...clean,
      id,
      version: (before?.saved.version ?? 0) + 1,
      updated: new Date().toISOString(),
    };
    const original =
      editedFrom !== undefined
        ? before?.history.find((entry) => entry.team.version === editedFrom)
            ?.team
        : undefined;
    const history = {
      team,
      summary: before ? "" : "Team created",
      ...(restoredFrom === undefined
        ? before
          ? {
              changes: teamChanges(original ?? before.saved, team),
              ...(editedFrom === undefined
                ? {}
                : { overwrote: before.saved.version }),
            }
          : {}
        : { restoredFrom }),
    };
    database
      .prepare(
        "INSERT INTO teams(id, definition_json, version, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition_json = excluded.definition_json, version = excluded.version, updated = excluded.updated",
      )
      .run(id, JSON.stringify(clean), team.version, team.updated);
    database
      .prepare(
        "INSERT INTO team_versions(team_id, version, value_json) VALUES (?, ?, ?)",
      )
      .run(id, team.version, JSON.stringify(history));
    return readTeam(id)!;
  }
  function removeTeamConversation(id: string): void {
    database.prepare("DELETE FROM team_conversations WHERE id = ?").run(id);
  }
  function removeTeamChild(id: string): void {
    database.prepare("DELETE FROM team_children WHERE id = ?").run(id);
  }
  function removeTeamTask(id: string): void {
    database.prepare("DELETE FROM team_tasks WHERE id = ?").run(id);
  }
  return {
    teamConversations,
    teamTasks,
    teamChildren,
    putTeamConversation,
    putTeamTask,
    putTeamChild,
    teamSettings,
    readTeam,
    listTeams,
    teamOperation,
    removeTeamConversation,
    removeTeamChild,
    removeTeamTask,
  };
}
