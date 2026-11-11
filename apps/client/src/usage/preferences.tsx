import { createContext, useContext } from "react";
export type UsageDisplay = "remaining" | "used";
export type UsageGraph = "bar" | "circle";
export const UsagePreferences = createContext<{
  display: UsageDisplay;
  graph: UsageGraph;
}>({ display: "used", graph: "bar" });
export const useUsagePreferences = () => useContext(UsagePreferences);
