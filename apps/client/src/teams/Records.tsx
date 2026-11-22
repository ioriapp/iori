import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, History } from "lucide-react";
import {
  definitionOrder,
  summarizeRecords,
  type CandidateSummary,
  type RecordsData,
  type RecordsFilter,
} from "@iori/protocol";
import { cn } from "cn";
import { connection } from "../connection.ts";
import { AsyncState, type AsyncViewMode } from "../components/AsyncState.tsx";
import { FlatPageHeader } from "../components/SectionLayout.tsx";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
import {
  boardTranslator,
  compactNumber,
  elapsedTime,
  recordMeasurement,
} from "./board-i18n.ts";
import { CliIcon } from "./context.tsx";
import {
  ComparisonChart,
  type ComparisonAxis,
} from "./records/ComparisonChart.tsx";
import { RecordDetail } from "./records/RecordDetail.tsx";

function candidateLabel(row: CandidateSummary) {
  return [
    row.candidate.cliName ?? row.candidate.cli,
    row.candidate.model,
    row.candidate.effort,
  ]
    .filter(Boolean)
    .join(" · ");
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground max-md:flex-col max-md:items-start max-md:gap-1">
      <span className="shrink-0">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          aria-label={label}
          className="h-8 w-auto min-w-22 text-xs max-md:min-w-25"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, text]) => (
            <SelectItem key={id} value={id}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type RecordsPreferences = {
  filter: RecordsFilter;
  axis: ComparisonAxis;
  custom: boolean;
  startDate: string;
  endDate: string;
};

function readPreferences(host: string): RecordsPreferences {
  const defaults: RecordsPreferences = {
    filter: { days: 30 },
    axis: "time",
    custom: false,
    startDate: "",
    endDate: "",
  };
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem(`iori-records-${host}`) ?? "{}"),
    };
  } catch {
    return defaults;
  }
}

export function Records(props: Parameters<typeof HostRecords>[0]) {
  return <HostRecords key={props.host} {...props} />;
}

function HostRecords({
  host,
  active,
  t: translate,
  language,
  onOpenTerminal,
  registerBack,
}: {
  host: string;
  active: boolean;
  t: (key: string) => string;
  language: string;
  onOpenTerminal: OpenTeamTerminal;
  registerBack?: (back: () => boolean) => void;
}) {
  const t = boardTranslator(translate, language);
  const [preferences, setPreferences] = useState(() => readPreferences(host));
  const { axis, custom, startDate, endDate } = preferences;
  const filter = useMemo<RecordsFilter>(
    () => ({
      ...preferences.filter,
      ...(custom
        ? {
            days: undefined,
            startAt: startDate
              ? new Date(`${startDate}T00:00:00`).getTime()
              : undefined,
            endAt: endDate
              ? new Date(`${endDate}T23:59:59.999`).getTime()
              : undefined,
          }
        : {}),
    }),
    [preferences],
  );

  useEffect(() => {
    try {
      localStorage.setItem(`iori-records-${host}`, JSON.stringify(preferences));
    } catch {
      // Filtering still works for this session when local storage is unavailable.
    }
  }, [host, preferences]);

  const [data, setData] = useState<RecordsData>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [candidateId, setCandidateId] = useState<string>();
  const [expanded, setExpanded] = useState<string>();

  useEffect(() => {
    if (!active) return;
    let current = true;
    setLoading(true);
    void connection
      .requestHost(host, "teams.records", filter)
      .then((result) => {
        if (!current) return;
        if (result?.ok) {
          const savedTeam = result.result.teams.find(
            (team) => team.id === filter.teamId,
          );
          if (filter.teamId && !savedTeam) {
            setPreferences((value) => ({
              ...value,
              filter: {
                ...value.filter,
                teamId: undefined,
                version: undefined,
              },
            }));
          } else if (
            filter.version !== undefined &&
            !savedTeam?.versions.includes(filter.version)
          ) {
            setPreferences((value) => ({
              ...value,
              filter: { ...value.filter, version: undefined },
            }));
          } else {
            setData(result.result);
          }
          setFailed(false);
        } else {
          setFailed(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (current) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [host, filter, active, retry]);

  useEffect(() => {
    if (!active || !registerBack) return;
    registerBack(() => {
      if (expanded) {
        setExpanded(undefined);
        return true;
      }
      if (candidateId) {
        setCandidateId(undefined);
        return true;
      }
      return false;
    });
    return () => registerBack(() => false);
  }, [active, registerBack, candidateId, expanded]);

  const [sort, setSort] = useState<{ column: number; descending: boolean }>({
    column: 0,
    descending: false,
  });

  const records = summarizeRecords(data?.tasks ?? []);
  const definedRoles = definitionOrder(data?.roleNames ?? [], language);
  const compareRoles = (a: string | undefined, b: string | undefined) =>
    definedRoles(a ?? "", b ?? "");
  const roles = [...new Set(records.map((row) => row.role))].sort(compareRoles);
  const defaultRows = [...records].sort(
    (a, b) =>
      compareRoles(a.role, b.role) ||
      candidateLabel(a).localeCompare(candidateLabel(b), language) ||
      a.key.localeCompare(b.key),
  );
  const numbers = new Map<string, number>();
  for (const role of roles) {
    defaultRows
      .filter((row) => row.role === role)
      .forEach((row, index) => numbers.set(row.key, index + 1));
  }
  const rows = [...defaultRows].sort((a, b) => {
    const value = (row: typeof a) =>
      [
        candidateLabel(row),
        row.tasks,
        row.agents,
        row.decided ? row.firstAccepted / row.decided : undefined,
        row.revisions / row.agents,
        row.rejected,
        row.time,
        row.input,
        row.output,
        row.cacheHit,
      ][sort.column];
    const x = value(a),
      y = value(b);
    if (x === undefined) return y === undefined ? 0 : 1;
    if (y === undefined) return -1;
    const order =
      typeof x === "string" && typeof y === "string"
        ? x.localeCompare(y, language)
        : Number(x) - Number(y);
    return sort.descending ? -order : order;
  });

  const measured = (value: string | undefined, count: number, total: number) =>
    recordMeasurement(value, count, total, language);
  const selectCandidate = (key: string) => {
    setCandidateId(key);
    setExpanded(undefined);
  };
  const selected = rows.find((row) => row.key === candidateId);
  const team = data?.teams.find((entry) => entry.id === filter.teamId);
  const columns = [
    "Tasks",
    "Agents",
    "First acceptance",
    "Revisions",
    "Rejected",
    "record.time",
    "Input",
    "Output",
    "Cache hit",
  ];

  const change = (next: RecordsFilter) => {
    setPreferences((value) => ({
      ...value,
      filter: {
        days: next.days,
        teamId: next.teamId,
        version: next.version,
        difficulty: next.difficulty,
      },
    }));
    setExpanded(undefined);
  };

  const hasFilters =
    custom || Object.values(filter).some((value) => value !== undefined);

  const clearFilters = () => {
    setPreferences((value) => ({
      ...value,
      filter: {},
      custom: false,
      startDate: "",
      endDate: "",
    }));
    setExpanded(undefined);
  };

  const viewMode: AsyncViewMode =
    data === undefined
      ? failed
        ? "error"
        : loading
          ? "loading"
          : "empty"
      : rows.length === 0
        ? "empty"
        : "ready";

  return (
    <section
      className="flex min-h-full w-full flex-col bg-background text-foreground md:h-full md:min-h-0 md:flex-row"
      data-iori-view="records"
    >
      <div
        data-iori-records-main
        className={cn(
          "min-w-0 flex-1 px-4 py-5 pb-8 md:overflow-auto md:px-6",
          selected && "max-md:hidden",
        )}
      >
        <div className="flex w-full min-w-0 flex-col gap-5">
          <FlatPageHeader title="Records" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-4">
            <div
              className={cn(
                "flex flex-wrap items-center gap-2",
                custom && "max-md:w-full",
              )}
            >
              <Filter
                label={t("Period")}
                value={custom ? "custom" : String(filter.days ?? "all")}
                options={[
                  ...(["7", "30", "90", "all"] as const).map(
                    (value): [string, string] => [
                      value,
                      t(value === "all" ? "All time" : `${value} days`),
                    ],
                  ),
                  ["custom", t("Choose dates")],
                ]}
                onChange={(value) => {
                  setPreferences((previous) => ({
                    ...previous,
                    custom: value === "custom",
                    filter: {
                      ...previous.filter,
                      days:
                        value === "all" || value === "custom"
                          ? undefined
                          : (Number(value) as 7 | 30 | 90),
                    },
                  }));
                  setExpanded(undefined);
                }}
              />
              {custom && (
                <div className="flex flex-wrap items-center gap-2 max-md:w-full max-md:items-start">
                  <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground max-md:min-w-0 max-md:flex-1 max-md:flex-col max-md:items-start max-md:gap-1">
                    <span>{t("Start date")}</span>
                    <Input
                      type="date"
                      className="h-8 w-auto min-w-0 text-xs [color-scheme:light] dark:[color-scheme:dark] max-md:w-full"
                      value={startDate}
                      onChange={(event) =>
                        setPreferences((value) => ({
                          ...value,
                          startDate: event.target.value,
                          endDate:
                            value.endDate && event.target.value > value.endDate
                              ? ""
                              : value.endDate,
                        }))
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground max-md:min-w-0 max-md:flex-1 max-md:flex-col max-md:items-start max-md:gap-1">
                    <span>{t("End date (optional)")}</span>
                    <Input
                      type="date"
                      className="h-8 w-auto min-w-0 text-xs [color-scheme:light] dark:[color-scheme:dark] max-md:w-full"
                      value={endDate}
                      min={startDate || undefined}
                      onChange={(event) =>
                        setPreferences((value) => ({
                          ...value,
                          endDate: event.target.validity.valid
                            ? event.target.value
                            : "",
                        }))
                      }
                    />
                  </label>
                </div>
              )}
            </div>
            <Filter
              label="Team"
              value={filter.teamId ?? "all"}
              options={[
                ["all", t("All")],
                ...(data?.teams ?? []).flatMap((entry) =>
                  entry.name
                    ? [[entry.id, entry.name] as [string, string]]
                    : [],
                ),
              ]}
              onChange={(value) =>
                change({
                  ...filter,
                  teamId: value === "all" ? undefined : value,
                  version: undefined,
                })
              }
            />
            {filter.teamId && (
              <Filter
                label={t("Version")}
                value={String(filter.version ?? "all")}
                options={[
                  ["all", t("All")],
                  ...(team?.versions ?? []).map(
                    (version) =>
                      [String(version), String(version)] as [string, string],
                  ),
                ]}
                onChange={(value) =>
                  change({
                    ...filter,
                    version: value === "all" ? undefined : Number(value),
                  })
                }
              />
            )}
            <Filter
              label={t("Difficulty")}
              value={filter.difficulty ?? "all"}
              options={[
                ["all", t("All")],
                ["high", t("High")],
                ["medium", t("Medium")],
                ["low", t("Low")],
              ]}
              onChange={(value) =>
                change({
                  ...filter,
                  difficulty:
                    value === "all"
                      ? undefined
                      : (value as "high" | "medium" | "low"),
                })
              }
            />
            <Filter
              label={t("X axis")}
              value={axis}
              options={[
                ["time", t("record.time")],
                ["tokens", t("Tokens")],
              ]}
              onChange={(value) =>
                setPreferences((previous) => ({
                  ...previous,
                  axis: value as ComparisonAxis,
                }))
              }
            />
          </div>

          {failed && data !== undefined && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3.5 py-2.5 text-xs text-foreground"
            >
              <p>{t("Could not load records. Retry.")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("Retry")}
              </Button>
            </div>
          )}

          <AsyncState
            mode={viewMode}
            t={t}
            emptyIcon={<History className="size-4" aria-hidden="true" />}
            emptyTitle={
              hasFilters
                ? t("No matching records")
                : t("Delegating work in a team will leave records here.")
            }
            emptyActionLabel={hasFilters ? t("Clear filters") : undefined}
            onEmptyAction={hasFilters ? clearFilters : undefined}
            errorTitle={t("Could not load records. Retry.")}
            onRetry={() => setRetry((value) => value + 1)}
          >
            <div className="flex flex-col gap-8">
              {roles.map((role) => (
                <section className="min-w-0" key={role ?? ""}>
                  {role && (
                    <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">
                      {role}
                    </h2>
                  )}
                  <ComparisonChart
                    rows={defaultRows.filter((row) => row.role === role)}
                    numbers={numbers}
                    axis={axis}
                    onSelect={selectCandidate}
                    t={t}
                  />
                  <div className="min-w-0 md:overflow-x-auto">
                    <div
                      className="flex flex-col divide-y divide-border-subtle border-y border-border md:grid md:grid-cols-[minmax(12.5rem,2fr)_repeat(9,minmax(max-content,1fr))] md:gap-x-2 md:divide-y-0 md:border-t-0 md:border-b-0"
                      role="table"
                      aria-label={role ?? "Records"}
                    >
                      <div
                        className="hidden items-center border-b border-border pb-2.5 text-2xs font-medium text-muted-foreground md:col-span-full md:grid md:grid-cols-subgrid"
                        role="row"
                      >
                        {["Candidate", ...columns].map((column, index) => (
                          <div
                            key={column}
                            role="columnheader"
                            className={cn(
                              "min-w-0 [overflow-wrap:anywhere]",
                              index > 0 && "text-right whitespace-nowrap",
                            )}
                            aria-sort={
                              sort.column === index
                                ? sort.descending
                                  ? "descending"
                                  : "ascending"
                                : undefined
                            }
                          >
                            <button
                              type="button"
                              className={cn(
                                "flex w-full min-w-0 cursor-pointer items-center gap-0.5 rounded-xs text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                                index > 0 &&
                                  "justify-end text-right whitespace-nowrap",
                              )}
                              aria-label={`${t(column)}: ${t(sort.column === index && !sort.descending ? "Sort descending" : "Sort ascending")}`}
                              onClick={() =>
                                setSort({
                                  column: index,
                                  descending:
                                    sort.column === index
                                      ? !sort.descending
                                      : false,
                                })
                              }
                            >
                              <span className="relative min-w-0">
                                {t(column)}
                                <span
                                  className={cn(
                                    "absolute top-1/2 inline-flex w-3 -translate-y-1/2",
                                    index > 0 ? "-left-3.5" : "-right-3.5",
                                  )}
                                  aria-hidden="true"
                                >
                                  {sort.column === index &&
                                    (sort.descending ? (
                                      <ArrowDown className="size-3" />
                                    ) : (
                                      <ArrowUp className="size-3" />
                                    ))}
                                </span>
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                      {rows
                        .filter((row) => row.role === role)
                        .map((row) => {
                          const values = [
                            String(row.tasks),
                            String(row.agents),
                            row.decided
                              ? `${row.firstAccepted}/${row.decided} · ${Math.round((row.firstAccepted / row.decided) * 100)}%`
                              : undefined,
                            (row.revisions / row.agents).toFixed(1),
                            String(row.rejected),
                            row.time === undefined
                              ? undefined
                              : elapsedTime(row.time),
                            measured(
                              row.input === undefined
                                ? undefined
                                : compactNumber(row.input),
                              row.measuredTokens,
                              row.agents,
                            ),
                            measured(
                              row.output === undefined
                                ? undefined
                                : compactNumber(row.output),
                              row.measuredTokens,
                              row.agents,
                            ),
                            measured(
                              row.cacheHit === undefined
                                ? undefined
                                : `${Math.round(row.cacheHit * 100)}%`,
                              row.measuredCache,
                              row.agents,
                            ),
                          ];
                          const isSelected = selected?.key === row.key;
                          return (
                            <div
                              role="row"
                              className={cn(
                                "grid w-full cursor-pointer grid-cols-1 gap-1.5 px-1 py-3 text-left text-xs tabular-nums transition-colors md:col-span-full md:grid-cols-subgrid md:items-center md:gap-y-0 md:border-b md:border-border-subtle md:px-0 md:py-3",
                                isSelected
                                  ? "bg-primary/14 font-semibold"
                                  : "bg-transparent [@media(hover:hover)]:hover:bg-accent/40",
                              )}
                              key={row.key}
                              data-iori-record-candidate={row.candidate.cli}
                              onClick={() => selectCandidate(row.key)}
                            >
                              <span
                                className="flex min-w-0 flex-col gap-1"
                                role="cell"
                              >
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-col gap-1 rounded-xs text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                >
                                  <strong className="inline-flex items-center gap-2 text-xs font-medium text-foreground [overflow-wrap:anywhere]">
                                    <span className="w-[2ch] shrink-0 text-right whitespace-nowrap tabular-nums text-muted-foreground">
                                      {numbers.get(row.key)}
                                    </span>
                                    <span className="shrink-0">
                                      <CliIcon
                                        name={row.candidate.cli}
                                        size={14}
                                      />
                                    </span>
                                    <span>
                                      {row.candidate.cliName ??
                                        row.candidate.cli}
                                    </span>
                                  </strong>
                                  <span className="pl-7 text-2xs text-muted-foreground [overflow-wrap:anywhere]">
                                    {[row.candidate.model, row.candidate.effort]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                </button>
                              </span>
                              {values.map((value, index) => (
                                <span
                                  className="flex min-w-0 justify-between gap-3 text-xs tabular-nums md:block md:text-right md:text-2xs md:whitespace-nowrap"
                                  role="cell"
                                  key={columns[index]}
                                >
                                  <span className="text-muted-foreground md:hidden">
                                    {t(columns[index]!)}
                                  </span>
                                  {value !== undefined && (
                                    <span
                                      className={cn(
                                        index === 2 &&
                                          "relative inline-block md:items-end",
                                      )}
                                    >
                                      {value}
                                      {index === 2 && (
                                        <span
                                          className="absolute top-[calc(100%+0.25rem)] right-0 hidden h-1 w-full max-w-18 overflow-hidden rounded-sm bg-muted md:block"
                                          aria-hidden="true"
                                        >
                                          <span
                                            className="block h-full bg-foreground/55"
                                            style={{
                                              width: `${(row.firstAccepted / row.decided) * 100}%`,
                                            }}
                                          />
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </AsyncState>
        </div>
      </div>
      {selected && (
        <RecordDetail
          host={host}
          selected={selected}
          tasks={data?.tasks ?? []}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onClose={() => {
            setCandidateId(undefined);
            setExpanded(undefined);
          }}
          onOpenTerminal={onOpenTerminal}
          t={t}
          language={language}
        />
      )}
    </section>
  );
}
