import type { Difficulty } from "@iori/protocol";
import { translator } from "../i18n.ts";

export function boardTranslator(t: (key: string) => string, language: string) {
  return language.toLowerCase().startsWith("ja") ? t : translator(language);
}

export function difficultyKey(difficulty: Difficulty) {
  return { high: "High", medium: "Medium", low: "Low" }[difficulty];
}

export function compactNumber(value: number) {
  const divisor = value >= 1_000_000 ? 1_000_000 : value >= 1000 ? 1000 : 1;
  return (
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(
      value / divisor,
    ) + (divisor === 1_000_000 ? "M" : divisor === 1000 ? "k" : "")
  );
}
export function elapsedTime(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
export function timeOf(at: number, language: string) {
  return new Date(at).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function recordMeasurement(
  value: string | undefined,
  measured: number,
  total: number,
  language: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (measured === total) return value;
  return language.toLowerCase().startsWith("ja")
    ? `${value}（${measured}人分）`
    : `${value} (${measured} agents)`;
}
