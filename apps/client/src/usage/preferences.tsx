import { createContext, useContext } from "react";
import type { UsageWindowSelection } from "@iori/protocol";
export type UsageDisplay = "remaining" | "used";
export type UsageGraph = "bar" | "circle";
export const UsagePreferences = createContext<{
  display: UsageDisplay;
  graph: UsageGraph;
  windows: Record<string, UsageWindowSelection>;
  setWindow: (cliId: string, selected?: UsageWindowSelection) => void;
}>({
  display: "used",
  graph: "bar",
  windows: {},
  setWindow: () => {},
});
export const useUsagePreferences = () => useContext(UsagePreferences);
