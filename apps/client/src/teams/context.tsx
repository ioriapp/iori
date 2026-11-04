import { createContext, useContext } from "react";
import type { CliSummary, CliModels } from "@iori/protocol";
import { CliIcon as Icon } from "../CliIcon.tsx";
export const TeamContext = createContext<{
  t: (key: string) => string;
  language: string;
  clis: CliSummary[];
  catalogs: Record<string, CliModels>;
  usageClis?: string[];
  loadingModels: Record<string, boolean>;
  hostName: string;
  cliNames: Record<string, string>;
}>({
  t: (key) => key,
  language: "en",
  clis: [],
  catalogs: {},
  loadingModels: {},
  cliNames: {},
  hostName: "",
});
export const useI18n = () => useContext(TeamContext);
export function CliIcon({ name, size }: { name: string; size: number }) {
  const { clis } = useI18n();
  return (
    <Icon
      cli={clis.find((c) => c.id === name) ?? { id: name, name }}
      size={size}
    />
  );
}
export function useCliName() {
  const { clis, cliNames } = useI18n();
  return (id: string) =>
    clis.find((c) => c.id === id)?.name ?? cliNames[id] ?? "";
}
export function useModelLabel() {
  const { catalogs } = useI18n();
  return (cli: string, model: string) =>
    catalogs[cli]?.models.find((entry) => entry.name === model)?.label || model;
}
