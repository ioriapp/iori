import { createContext, useContext, useEffect, useId } from "react";
import { Check } from "lucide-react";
import type { UsageWindowSelection } from "@iori/protocol";
import {
  useSettingsEditor,
  type RegisterSettingsEditor,
} from "../settings-save.ts";
import type { WorkspaceViewKind } from "../workspace-panel.tsx";
import type { TerminalLinkOpen } from "../terminal/link-click.ts";
import type { TerminalInputPreferences } from "../terminal/TerminalPane.tsx";
import type { LastWorkspaceTarget } from "../WorkspaceFrame.tsx";

export const DEFAULT_SIDEBAR_WIDTH = 360;
export const UI_FONT_MIN = 12;
export const UI_FONT_MAX = 24;
export const UI_FONT_DEFAULT = 16;

export type Preferences = {
  notifyWaiting: boolean;
  notifyDone: boolean;
  backgroundConnection: boolean;
  unifiedPushDistributor?: string;
  notificationPrompted: boolean;
  closeToExit: boolean;
  receiveDevelopmentVersions?: boolean;
  language: "system" | "en" | "ja";
  theme: "system" | "light" | "dark";
  fontSize: number;
  usageDisplay?: "remaining" | "used";
  usageWindows?: Record<string, UsageWindowSelection>;
  terminalFontSize: number;
  terminalFontFamily: string;
  showForgeStatus?: boolean;
  terminalRightClick: "menu" | "copyPaste";
  terminalLinkOpen: TerminalLinkOpen;
  doubleClickMaximize: boolean;
  panelWidths: Partial<Record<WorkspaceViewKind, number>>;
  panelFullWidth: Partial<Record<WorkspaceViewKind, boolean>>;
  hostOrder?: string[];
  sidebarCollapsed?: string[];
  sidebarWidth?: number;
  lastWorkspaceTarget?: LastWorkspaceTarget;
  /** The phone key band, read leniently with normalizeTerminalAccessoryLayout. */
  keyboard?: unknown;
  terminalInput?: TerminalInputPreferences;
};

export type SettingsSection =
  | "general"
  | "notifications"
  | "display"
  | "keyboard"
  | "connection"
  | "devices"
  | "integrations"
  | "git"
  | "version";

export type Translate = (key: string) => string;

export const SettingsDirtyContext = createContext<
  ((editorId: string, dirty: boolean) => void) | undefined
>(undefined);

/**
 * Registers an explicitly-saved settings editor with discard and save handlers,
 * and reports live dirty state to SettingsDialog for header/nav indicators.
 */
export function useSaveableSettingsEditor(
  dirty: boolean,
  isDirty: () => boolean,
  register?: RegisterSettingsEditor,
  discard?: () => void,
  save?: () => Promise<boolean>,
) {
  const editorId = useId();
  const reportDirty = useContext(SettingsDirtyContext);
  useSettingsEditor(isDirty, register, discard, save);

  useEffect(() => {
    if (!reportDirty) return;
    reportDirty(editorId, dirty);
    return () => reportDirty(editorId, false);
  }, [reportDirty, editorId, dirty]);
}

export function ErrorMessage({ message }: { message?: string }) {
  return message ? (
    <p
      className="m-0 w-full text-xs leading-relaxed text-status-failed-text [overflow-wrap:anywhere]"
      role="alert"
      data-iori-state="error"
    >
      {message}
    </p>
  ) : null;
}

export function InstantSavedStatus({
  visible,
  t,
}: {
  visible: boolean;
  t: Translate;
}) {
  if (!visible) return null;
  return (
    <span
      role="status"
      className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-status-running-text"
    >
      <Check className="size-3" aria-hidden="true" />
      {t("Saved")}
    </span>
  );
}
