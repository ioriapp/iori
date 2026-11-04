import { definitionOrder } from "@iori/protocol";
import {
  PageHeader,
  PageBody,
  FieldRow,
  LoadRecovery,
} from "../components/page-layout.tsx";
import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, ArrowDown, ArrowUp } from "lucide-react";
import {
  summarizeRecords,
  taskWorkTime,
  candidateKey,
  type CandidateSummary,
  type RecordsData,
  type RecordsFilter,
} from "@iori/protocol";
import { connection } from "../connection.ts";
import { Input } from "../components/ui/input.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.tsx";
import { TaskHistory, type OpenTeamTerminal } from "./TaskHistory.tsx";
import { ChangeAmount } from "./Board.tsx";
import {
  boardTranslator,
  compactNumber,
  elapsedTime,
  recordMeasurement,
} from "./board-i18n.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.tsx";
import { CliIcon } from "./context.tsx";
import "./records.css";
type ComparisonAxis = "time" | "tokens";
function comparisonTicks(values: number[], axis: ComparisonAxis) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const ticks: number[] = [];
  const units = axis === "time" ? [1000, 60_000, 3_600_000] : [1];
  for (const [index, unit] of units.entries()) {
    const lower = index === 0 ? minimum / 10 : unit;
    const upper = units[index + 1] ?? maximum * 10;
    for (
      let exponent = Math.floor(Math.log10(lower / unit));
      exponent <= Math.ceil(Math.log10(upper / unit));
      exponent++
    ) {
      for (const multiple of [1, 2, 5]) {
        const value = multiple * 10 ** exponent * unit;
        if (
          (index === 0 || value >= unit) &&
          (index === units.length - 1 || value < upper)
        )
          ticks.push(value);
      }
    }
  }
  const first = ticks.findIndex((value) => value > minimum) - 1;
  const last = ticks.findIndex((value) => value >= maximum);
  return ticks.slice(first, Math.max(first + 2, last + 1));
}
function candidateLabel(row: CandidateSummary) {
  return [
    row.candidate.cliName ?? row.candidate.cli,
    row.candidate.model,
    row.candidate.effort,
  ]
    .filter(Boolean)
    .join(" · ");
}
function Comparison({
  rows,
  axis,
  numbers,
  onSelect,
  t,
}: {
  rows: CandidateSummary[];
  axis: ComparisonAxis;
  numbers: Map<string, number>;
  onSelect: (key: string) => void;
  t: (key: string) => string;
}) {
  const chartId = useId();
  const [plot, setPlot] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!plot) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry!.contentRect.width);
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, [plot]);
  const points = rows.filter(
    (row) => row.decided > 0 && row[axis] !== undefined && row[axis]! > 0,
  );
  if (!points.length) return null;
  const ticks = comparisonTicks(
    points.map((row) => row[axis]!),
    axis,
  );
  const minimum = ticks[0]!;
  const maximum = ticks.at(-1)!;
  const largest = Math.max(...points.map((row) => row.tasks));
  const radius = (row: CandidateSummary) =>
    4 + 10 * Math.sqrt(row.tasks / largest);
  const horizontalPadding = 16 + Math.max(...points.map(radius));
  const xPosition = (value: number) =>
    horizontalPadding +
    (Math.log(value / minimum) / Math.log(maximum / minimum)) *
      (width - horizontalPadding * 2);
  const format = axis === "time" ? elapsedTime : compactNumber;
  const tickLabel = (value: number) =>
    axis === "time" ? format(value).replace(/ 0m$/, "") : format(value);
  const measure = plot?.ownerDocument.createElement("canvas").getContext("2d");
  if (measure && plot) measure.font = getComputedStyle(plot).font;
  const labelWidth = (value: number) =>
    measure?.measureText(tickLabel(value)).width ?? 0;
  const primaryTick = (value: number) => {
    const unit =
      axis === "time"
        ? value >= 3_600_000
          ? 3_600_000
          : value >= 60_000
            ? 60_000
            : 1000
        : 1;
    return Number.isInteger(Math.log10(value / unit));
  };
  const labelledTicks = new Set(ticks.filter(primaryTick));
  // Narrow ranges still need two labels, even when they contain no decade.
  if (labelledTicks.size < 2) {
    labelledTicks.add(minimum);
    labelledTicks.add(maximum);
  }
  const fits = (value: number) =>
    [...labelledTicks].every(
      (other) =>
        Math.abs(xPosition(value) - xPosition(other)) >=
        (labelWidth(value) + labelWidth(other)) / 2 + 8,
    );
  // At phone widths use the regular major intervals, rather than an uneven
  // selection of whichever minor labels happen to fit from left to right.
  if (
    ticks.reduce((total, value) => total + labelWidth(value) + 8, 0) <=
    width - horizontalPadding * 2
  ) {
    for (const value of ticks)
      if (!labelledTicks.has(value) && fits(value)) labelledTicks.add(value);
  }
  const candidateName = (row: CandidateSummary) =>
    [
      row.candidate.cliName ?? row.candidate.cli,
      [row.candidate.model, row.candidate.effort].filter(Boolean).join(" · "),
    ]
      .filter(Boolean)
      .join(" › ");
  const height = points.length === 1 ? 96 : 160;
  const position = (row: CandidateSummary) => ({
    x: xPosition(row[axis]!),
    y: 16 + (row.firstAccepted / row.decided) * height,
  });
  const groups: CandidateSummary[][] = [];
  for (const row of points) {
    const group = groups.find(
      ([first]) =>
        Math.hypot(
          position(first!).x - position(row).x,
          position(first!).y - position(row).y,
        ) <
        radius(first!) + radius(row),
    );
    if (group) group.push(row);
    else groups.push([row]);
  }
  const groupNumber = (group: CandidateSummary[]) =>
    group
      .map((candidate) => numbers.get(candidate.key)!)
      .sort((a, b) => a - b)
      .join("·");
  // Labels can combine without moving or removing their underlying circles.
  const numberGroups = groups.map((group) => [group]);
  const numberWidth = (group: CandidateSummary[][]) =>
    measure?.measureText(groupNumber(group.flat())).width ?? 0;
  const numberPosition = (group: CandidateSummary[][]) => {
    const positions = group.map(([row]) => position(row!));
    return {
      x: Math.max(
        numberWidth(group) / 2,
        Math.min(
          width - numberWidth(group) / 2,
          (Math.min(...positions.map((p) => p.x)) +
            Math.max(...positions.map((p) => p.x))) /
            2,
        ),
      ),
      y: Math.max(...positions.map((p) => p.y)),
    };
  };
  for (let index = 0; index < numberGroups.length; index++) {
    const group = numberGroups[index]!;
    const other = numberGroups.findIndex(
      (candidate, at) =>
        at > index &&
        Math.abs(numberPosition(candidate).y - numberPosition(group).y) < 18 &&
        Math.abs(numberPosition(candidate).x - numberPosition(group).x) <
          (numberWidth(candidate) + numberWidth(group)) / 2 + 4,
    );
    if (other >= 0) {
      group.push(...numberGroups.splice(other, 1)[0]!);
      index = -1;
    }
  }
  return (
    <div
      className="record-comparison"
      aria-label={`${t("First acceptance")} / ${axis === "time" ? "Time" : "Tokens"}`}
    >
      <div className="record-chart-caption">{t("First acceptance")}</div>
      <div
        className="record-plot"
        ref={setPlot}
        style={{ height: height + 32 }}
      >
        <svg
          className="record-chart-grid"
          width="100%"
          height="100%"
          aria-hidden="true"
        >
          {ticks.map((value) => (
            <line
              key={`x-${value}`}
              x1={xPosition(value)}
              x2={xPosition(value)}
              y1={height + 28}
              y2={height + 32}
            />
          ))}
          {[0, 50, 100].map((value) => (
            <line
              key={value}
              x1="16"
              x2={Math.max(16, width - 16)}
              y1={16 + (value / 100) * height}
              y2={16 + (value / 100) * height}
            />
          ))}
        </svg>
        {[0, 50, 100].map((value) => (
          <span
            key={value}
            className="record-chart-y"
            style={{ bottom: 16 + (value / 100) * height }}
          >
            {value}%
          </span>
        ))}
        {ticks
          .filter((value) => labelledTicks.has(value))
          .map((value) => (
            <span
              key={value}
              className="record-chart-x"
              style={{
                left: xPosition(value),
              }}
            >
              {tickLabel(value)}
            </span>
          ))}
        {groups.map((group) => {
          const row = group[0]!;
          const { x, y } = position(row);
          const labelIndex = numberGroups.findIndex((label) =>
            label.includes(group),
          );
          return (
            <Tooltip key={row.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="record-chart-point"
                  data-iori-record-point={row.candidate.cli}
                  aria-label={group.map(candidateName).join(", ")}
                  aria-describedby={`${chartId}-number-${labelIndex}`}
                  style={{ left: x, bottom: y }}
                  onClick={() => onSelect(row.key)}
                >
                  <svg width="32" height="32" aria-hidden="true">
                    <circle cx="16" cy="16" r={radius(row)} />
                  </svg>
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="record-chart-tooltip"
                side={y >= (height + 32) / 2 ? "bottom" : "top"}
                sideOffset={Math.max(y + 8, height + 32 - y + 24)}
                collisionBoundary={plot?.closest(".records-main")}
                collisionPadding={8}
              >
                <div className="record-chart-tooltip-candidates">
                  {group.map((candidate) => (
                    <div key={candidate.key}>
                      <span className="record-chart-tooltip-name">
                        <span className="record-chart-tooltip-number">
                          {numbers.get(candidate.key)} ·
                        </span>
                        <CliIcon name={candidate.candidate.cli} size={14} />
                        <span>{candidateName(candidate)}</span>
                      </span>
                      <br />
                      {t("First acceptance")}:{" "}
                      {Math.round(
                        (candidate.firstAccepted / candidate.decided) * 100,
                      )}
                      % · {axis === "time" ? "Time" : "Tokens"}:{" "}
                      {format(candidate[axis]!)} · Tasks: {candidate.tasks}
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
        {numberGroups.map((group, index) => (
          <span
            key={group[0]![0]!.key}
            id={`${chartId}-number-${index}`}
            className="record-chart-number"
            style={{
              left: numberPosition(group).x,
              bottom: numberPosition(group).y + 16,
            }}
          >
            {groupNumber(group.flat())}
          </span>
        ))}
      </div>
      <div className="record-chart-axis">
        {axis === "time" ? "Time" : "Tokens"}
      </div>
    </div>
  );
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
    <FieldRow className="record-filter">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
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
    </FieldRow>
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
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const [candidateId, setCandidateId] = useState<string>(),
    [expanded, setExpanded] = useState<string>();
  useEffect(() => {
    if (!active) return;
    let current = true;
    void connection
      .requestHost(host, "teams.records", filter)
      .then((result) => {
        if (current) {
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
          } else setFailed(true);
        }
      })
      .catch(() => {
        if (current) setFailed(true);
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
  const label = (column: string) =>
    ["Time", "Input", "Output", "Cache hit"].includes(column)
      ? column
      : t(column);
  const measured = (value: string | undefined, count: number, total: number) =>
    recordMeasurement(value, count, total, language);
  const selectCandidate = (key: string) => {
    setCandidateId(key);
    setExpanded(undefined);
  };
  const selected = rows.find((row) => row.key === candidateId);
  const team = data?.teams.find((team) => team.id === filter.teamId);
  const columns = [
    "Tasks",
    "Agents",
    "First acceptance",
    "Revisions",
    "Rejected",
    "Time",
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
  return (
    <section
      className={`records-page ${selected ? "records-with-detail" : ""}`}
      data-iori-view="records"
    >
      <PageBody width="full" className="records-main">
        <PageHeader title="Records" />
        <div className="record-filters">
          <div className="record-period">
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
              <div className="record-date-fields">
                <label className="record-filter">
                  <span>{t("Start date")}</span>
                  <Input
                    type="date"
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
                <label className="record-filter">
                  <span>{t("End date (optional)")}</span>
                  <Input
                    type="date"
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
              ...(data?.teams ?? []).flatMap((team) =>
                team.name ? [[team.id, team.name] as [string, string]] : [],
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
              label="Version"
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
            label="Difficulty"
            value={filter.difficulty ?? "all"}
            options={[
              ["all", t("All")],
              ["high", "High"],
              ["medium", "Medium"],
              ["low", "Low"],
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
              ["time", "Time"],
              ["tokens", "Tokens"],
            ]}
            onChange={(value) =>
              setPreferences((previous) => ({
                ...previous,
                axis: value as ComparisonAxis,
              }))
            }
          />
        </div>
        {failed && (
          <LoadRecovery
            message={t("Could not load records. Retry.")}
            retryLabel={t("Retry")}
            buttonSize="lg"
            onRetry={() => setRetry((value) => value + 1)}
          />
        )}
        <div className="record-roles">
          {roles.map((role) => (
            <section className="record-role" key={role ?? ""}>
              {role && <h2>{role}</h2>}
              <Comparison
                rows={defaultRows.filter((row) => row.role === role)}
                numbers={numbers}
                axis={axis}
                onSelect={selectCandidate}
                t={t}
              />
              <div
                className="record-table"
                role="table"
                aria-label={role ?? "Records"}
              >
                <div className="record-table-head" role="row">
                  {["Candidate", ...columns].map((column, index) => (
                    <div
                      key={column}
                      role="columnheader"
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
                        className="record-sort"
                        aria-label={`${label(column)}: ${t(sort.column === index && !sort.descending ? "Sort descending" : "Sort ascending")}`}
                        onClick={() =>
                          setSort({
                            column: index,
                            descending:
                              sort.column === index ? !sort.descending : false,
                          })
                        }
                      >
                        <span className="record-sort-label">
                          {label(column)}
                          <span
                            className="record-sort-direction"
                            aria-hidden="true"
                          >
                            {sort.column === index &&
                              (sort.descending ? (
                                <ArrowDown size={12} />
                              ) : (
                                <ArrowUp size={12} />
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
                    return (
                      <div
                        role="row"
                        className={`record-row ${selected?.key === row.key ? "selected" : ""}`}
                        key={row.key}
                        data-iori-record-candidate={row.candidate.cli}
                        onClick={() => {
                          setCandidateId(row.key);
                          setExpanded(undefined);
                        }}
                      >
                        <span className="record-candidate" role="cell">
                          <button
                            type="button"
                            className="record-candidate text-left"
                          >
                            <strong className="record-candidate-name">
                              <span className="record-candidate-number">
                                {numbers.get(row.key)}
                              </span>
                              <CliIcon name={row.candidate.cli} size={14} />
                              {row.candidate.cliName ?? row.candidate.cli}
                            </strong>
                            <span>
                              {[row.candidate.model, row.candidate.effort]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </button>
                        </span>
                        {values.map((value, index) => (
                          <span
                            className="record-cell"
                            role="cell"
                            key={columns[index]}
                          >
                            <span className="record-cell-label">
                              {label(columns[index]!)}
                            </span>
                            {value !== undefined && (
                              <span
                                className={
                                  index === 2 ? "record-acceptance" : undefined
                                }
                              >
                                {value}
                                {index === 2 && (
                                  <span
                                    className="record-acceptance-track"
                                    aria-hidden="true"
                                  >
                                    <span
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
            </section>
          ))}
        </div>
        {data && !rows.length && !failed && (
          <div className="record-empty">
            {custom ||
            Object.values(filter).some((value) => value !== undefined) ? (
              <>
                <p>{t("No matching records")}</p>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    setPreferences((value) => ({
                      ...value,
                      filter: {},
                      custom: false,
                      startDate: "",
                      endDate: "",
                    }));
                    setExpanded(undefined);
                  }}
                >
                  {t("Clear filters")}
                </Button>
              </>
            ) : (
              <p>{t("Delegating work in a team will leave records here.")}</p>
            )}
          </div>
        )}
      </PageBody>
      {selected && (
        <aside className="record-detail" data-iori-view="record-task-list">
          <PageHeader
            className="record-detail-heading"
            back={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Back")}
                onClick={() => {
                  setCandidateId(undefined);
                  setExpanded(undefined);
                }}
              >
                <ArrowLeft size={16} />
              </Button>
            }
            title={
              <>
                {selected.role} ·{" "}
                {selected.candidate.cliName ?? selected.candidate.cli}
              </>
            }
            description={[selected.candidate.model, selected.candidate.effort]
              .filter(Boolean)
              .join(" · ")}
          />
          {data?.tasks
            .filter((task) => selected.taskIds.includes(task.id))
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((task) => {
              const tokens = task.agents.filter((agent) => agent.tokens);
              const handoff =
                task.agents[0]?.candidate &&
                candidateKey(task.agents[0].role, task.agents[0].candidate) !==
                  selected.key;
              return (
                <Collapsible
                  asChild
                  key={task.id}
                  open={expanded === task.id}
                  onOpenChange={(open) =>
                    setExpanded(open ? task.id : undefined)
                  }
                >
                  <article className="record-task">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="record-task-open"
                        data-iori-record-task={task.id}
                        aria-expanded={expanded === task.id}
                      >
                        <time>
                          {new Date(task.createdAt).toLocaleDateString(
                            language,
                          )}
                        </time>
                        <strong>
                          {task.title}
                          {handoff && (
                            <small className="record-handoff">Handoff</small>
                          )}
                        </strong>
                        <small>
                          {task.team} · Version {task.version} · Difficulty{" "}
                          {task.difficulty[0]!.toUpperCase() +
                            task.difficulty.slice(1)}{" "}
                          · Revisions {task.revisions}
                        </small>
                        <span>
                          {task.decision
                            ? task.decision === "accept"
                              ? "Accepted"
                              : "Rejected"
                            : "Pending"}
                          {task.reason && ` · ${task.reason}`}
                        </span>
                        <small>
                          {taskWorkTime(task) !== undefined &&
                            `${elapsedTime(taskWorkTime(task)!)} · `}
                          {task.changes && (
                            <ChangeAmount
                              changes={task.changes}
                              language={language}
                            />
                          )}{" "}
                          {tokens.length > 0 &&
                            `${compactNumber(tokens.reduce((sum, agent) => sum + agent.tokens!.input + agent.tokens!.output, 0))} tokens${tokens.length < task.agents.length ? (language.toLowerCase().startsWith("ja") ? `（${tokens.length}人分）` : ` (${tokens.length} agents)`) : ""}`}
                        </small>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="record-task-history">
                        <TaskHistory
                          host={host}
                          task={task.id}
                          t={t}
                          language={language}
                          onOpenTerminal={onOpenTerminal}
                        />
                      </div>
                    </CollapsibleContent>
                  </article>
                </Collapsible>
              );
            })}
        </aside>
      )}
    </section>
  );
}
