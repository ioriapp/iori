import { useEffect, useId, useState } from "react";
import type { CandidateSummary } from "@iori/protocol";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip.tsx";
import { compactNumber, elapsedTime } from "../board-i18n.ts";
import { CliIcon } from "../context.tsx";

export type ComparisonAxis = "time" | "tokens";

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

export function ComparisonChart({
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
  const axisLabel = t(axis === "time" ? "record.time" : "Tokens");
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
      className="max-w-240 pb-6 text-xs text-muted-foreground"
      aria-label={`${t("First acceptance")} / ${axisLabel}`}
    >
      <div className="mb-2">{t("First acceptance")}</div>
      <div
        className="relative mt-5 mr-0 mb-6.5 ml-11"
        ref={setPlot}
        style={{ height: height + 32 }}
      >
        <svg
          className="absolute inset-0 stroke-border"
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
            className="absolute right-[calc(100%+0.25rem)] translate-y-1/2 tabular-nums"
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
              className="absolute top-full -translate-x-1/2 whitespace-nowrap tabular-nums"
              style={{ left: xPosition(value) }}
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
                  className="group absolute size-8 -translate-x-1/2 translate-y-1/2 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-iori-record-point={row.candidate.cli}
                  aria-label={group.map(candidateName).join(", ")}
                  aria-describedby={`${chartId}-number-${labelIndex}`}
                  style={{ left: x, bottom: y }}
                  onClick={() => onSelect(row.key)}
                >
                  <svg width="32" height="32" aria-hidden="true">
                    <circle
                      cx="16"
                      cy="16"
                      r={radius(row)}
                      className="fill-muted-foreground stroke-background stroke-2 transition-colors group-hover:fill-foreground group-focus-visible:fill-foreground"
                    />
                  </svg>
                </button>
              </TooltipTrigger>
              <TooltipContent
                className="max-h-(--radix-tooltip-content-available-height) overflow-y-auto [&_.cli-icon-dark]:block [&_.cli-icon-light]:hidden dark:[&_.cli-icon-dark]:hidden dark:[&_.cli-icon-light]:block"
                side={y >= (height + 32) / 2 ? "bottom" : "top"}
                sideOffset={Math.max(y + 8, height + 32 - y + 24)}
                collisionBoundary={plot?.closest("[data-iori-records-main]")}
                collisionPadding={8}
              >
                <div className="grid gap-2">
                  {group.map((candidate) => (
                    <div key={candidate.key}>
                      <span className="inline-flex items-center gap-2 [&>.cli-icon]:shrink-0 [&>svg]:shrink-0">
                        <span className="shrink-0 whitespace-nowrap tabular-nums">
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
                      % · {axisLabel}: {format(candidate[axis]!)} · {t("Tasks")}
                      : {candidate.tasks}
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
            className="pointer-events-none absolute flex w-max -translate-x-1/2 items-center gap-1 overflow-hidden text-left whitespace-nowrap tabular-nums [text-shadow:-1px_-1px_var(--background),1px_-1px_var(--background),-1px_1px_var(--background),1px_1px_var(--background)]"
            style={{
              left: numberPosition(group).x,
              bottom: numberPosition(group).y + 16,
            }}
          >
            {groupNumber(group.flat())}
          </span>
        ))}
      </div>
      <div className="text-center">{axisLabel}</div>
    </div>
  );
}
