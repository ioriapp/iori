import type { CliSummary, Team, TeamList } from "@iori/protocol";

export const allStates = [
  { id: "team-parent-template", label: "新しいTeam・テンプレート" },
  { id: "team-parent-picker", label: "新しいTeam・CLIとモデル" },
  { id: "team-parent-existing", label: "新しいTeam・既存のTeam" },
  { id: "team-parent-no-cli", label: "新しいTeam・CLIなし" },
  { id: "team-parent-no-cli-picker", label: "新しいTeam・CLIなしの一覧" },
  { id: "team-parent-empty", label: "候補なし・親と同じ設定" },
  { id: "team-parent-empty-high", label: "高の候補なし・親と同じ設定" },
  { id: "team-parent-unset", label: "候補なし・親が未設定" },
];

export function teamEditorFixture(state: string) {
  const cliList: CliSummary[] = state.includes("no-cli")
    ? []
    : [
        { id: "claude", name: "Claude Code" },
        { id: "codex", name: "Codex" },
      ];
  const parent = {
    id: "parent",
    cli: state === "team-parent-unset" ? "" : "claude",
    model: "",
    tools: [],
    minimum: "",
  };
  const team: Team = {
    id: "development",
    name: "Development",
    description: "",
    instruction: "",
    version: 1,
    updated: "2026-11-17T00:00:00Z",
    parent,
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "",
        limit: "",
        reuse: true,
        split: state === "team-parent-empty-high",
        candidates: {
          high: [],
          medium:
            state === "team-parent-empty-high"
              ? [{ ...parent, id: "medium" }]
              : [],
          low: [],
        },
        instruction: "",
        request: "",
        report: "",
      },
    ],
  };
  const initial: TeamList = {
    enabled: true,
    defaultTeam: "",
    limits: {},
    teams: [{ saved: team, history: [{ team, summary: "" }], hidden: false }],
    templates: Object.fromEntries(
      ["development", "research", "writing", "minimal"].map((name) => [
        name,
        { ...team, name },
      ]),
    ),
    cliNames: {},
  };
  const role = [
    "team-parent-empty",
    "team-parent-empty-high",
    "team-parent-unset",
  ].includes(state);
  return {
    cliList,
    initial,
    values: {
      selection: role
        ? { page: "team", teamId: team.id, detail: "worker" }
        : { page: "teams" },
      mobileDetail: role,
      expanded: { [team.id]: true },
      newTeamOpen: !role,
      teamSource:
        state === "team-parent-existing"
          ? "existing:development"
          : "template:development",
      difficulty: state === "team-parent-empty-high" ? "high" : "medium",
    },
  };
}
