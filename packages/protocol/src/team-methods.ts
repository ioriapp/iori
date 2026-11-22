import * as v from "valibot";
import {
  schema,
  record,
  method,
  hostResult,
  emptyParams,
  identifier,
  integer,
  decoded,
  hasMethod,
  paramsOf,
  type ResultSchemas,
  type Params,
  type Results,
} from "./primitives.ts";
import { parseChildrenResult } from "./terminal-values.ts";
import {
  candidate,
  teamDefinition,
  teamSettings,
  type CliModels,
  type TeamRecord,
  type TeamList,
  type TeamSettings,
} from "./teams.ts";
import type {
  BoardData,
  BoardSummary,
  RecordsData,
  TaskHistoryData,
} from "./board.ts";
const boardFilter = v.pipe(
  v.object({
    startAt: v.optional(v.pipe(v.number(), v.finite())),
    endAt: v.optional(v.pipe(v.number(), v.finite())),
    days: v.optional(v.picklist([7, 30, 90])),
    version: v.optional(integer(1)),
    difficulty: v.optional(v.picklist(["high", "medium", "low"])),
    teamId: v.optional(identifier),
  }),
  v.check(
    ({ startAt, endAt }) =>
      startAt === undefined || endAt === undefined || startAt <= endAt,
  ),
);

const teamSource = schema(
  v.pipe(
    v.object({
      template: v.optional(identifier),
      sourceId: v.optional(identifier),
      definition: v.optional(teamDefinition),
      language: v.optional(v.picklist(["en", "ja"])),
      parent: v.optional(candidate),
      name: v.optional(identifier),
    }),
    v.check(
      (input) =>
        [input.template, input.sourceId, input.definition].filter(
          (x) => x !== undefined,
        ).length === 1 &&
        (input.template === undefined || input.language !== undefined),
    ),
  ),
);
const createTeam = decoded((value) => {
  const { language, parent, ...source } = record(value);
  // Only the template source consumes a language and an optional parent.
  return teamSource.parse({
    ...source,
    ...(source.template === undefined
      ? {}
      : { language, ...(parent === undefined ? {} : { parent }) }),
  });
});
export const teamMethods = {
  "teams.board": method(v.object({ cwd: identifier }), hostResult<BoardData>()),
  "teams.boards": method(emptyParams, hostResult<{ boards: BoardSummary[] }>()),
  "teams.records": method(boardFilter, hostResult<RecordsData>()),
  "teams.task.history": method(
    v.object({ taskId: identifier }),
    hostResult<TaskHistoryData>(),
  ),
  "teams.children": method(
    v.object({
      conversation: v.optional(identifier),
      cwd: v.optional(identifier),
    }),
    { parse: parseChildrenResult },
  ),
  "teams.child.stop": method(
    v.object({ childId: identifier }),
    hostResult<{ childId: string }>(),
  ),
  "teams.list": method(emptyParams, hostResult<TeamList>()),
  "teams.read": method(
    v.object({ teamId: identifier }),
    hostResult<TeamRecord>(),
  ),
  "teams.create": method(createTeam, hostResult<TeamRecord>()),
  "teams.save": method(
    v.object({
      teamId: identifier,
      definition: teamDefinition,
      baseVersion: v.optional(integer(1)),
      editedFrom: v.optional(integer(1)),
    }),
    hostResult<
      | TeamRecord
      | { conflict: "changed"; current: TeamRecord }
      | { conflict: "deleted" }
    >(),
  ),
  "teams.memo": method(
    v.object({ teamId: identifier, version: integer(1), memo: v.string() }),
    hostResult<TeamRecord>(),
  ),
  "teams.restore": method(
    v.object({ teamId: identifier, version: integer(1) }),
    hostResult<TeamRecord>(),
  ),
  "teams.duplicate": method(
    v.object({ teamId: identifier, name: v.optional(identifier) }),
    hostResult<TeamRecord>(),
  ),
  "teams.hidden.set": method(
    v.object({ teamId: identifier, hidden: v.boolean() }),
    hostResult<{ teamId: string; hidden: boolean }>(),
  ),
  "teams.delete": method(
    v.object({ teamId: identifier }),
    hostResult<{ teamId: string }>(),
  ),
  "teams.settings": method(teamSettings, hostResult<TeamSettings>()),
  "cli.models": method(
    v.object({ cliId: identifier }),
    hostResult<CliModels>(),
  ),
};

export type TeamMethod = keyof typeof teamMethods;
export type TeamParamsByMethod = Params<typeof teamMethods>;
export type TeamResultByMethod = Results<typeof teamMethods>;
export function isTeamMethod(value: unknown): value is TeamMethod {
  return hasMethod(teamMethods, value);
}
export function parseTeamParams<M extends TeamMethod>(
  key: M,
  value: unknown,
): TeamParamsByMethod[M] {
  return paramsOf<TeamParamsByMethod, M>(teamMethods, key, value);
}
// Keep the domain-only result readers compatible with stored Host values.
export const teamResultSchemas: ResultSchemas<TeamResultByMethod> = {
  ...teamMethods,
  "teams.children": hostResult<TeamResultByMethod["teams.children"]>(),
};
