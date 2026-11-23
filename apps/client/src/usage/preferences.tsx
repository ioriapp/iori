import { createContext, useContext } from "react";
import type { UsageWindowSelection } from "@iori/protocol";
export type UsageDisplay = "remaining" | "used";
export const UsagePreferences = createContext<{
  display: UsageDisplay;
  windows: Record<string, UsageWindowSelection>;
  setWindow: (cliId: string, selected?: UsageWindowSelection) => void;
}>({
  display: "used",
  windows: {},
  setWindow: () => {},
});
export const useUsagePreferences = () => useContext(UsagePreferences);
