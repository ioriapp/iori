import { useSyncExternalStore } from "react";
import { native } from "./native.ts";
import { notices } from "./notices.ts";
import {
  readWorktreeLayoutTemplate,
  type WorktreeLayoutTemplate,
} from "./new-worktree-layout.ts";

const key = "new-worktree-default";
let state: { saved: boolean; save?: () => WorktreeLayoutTemplate | undefined } =
  { saved: false };
const listeners = new Set<() => void>();
const publish = (next: typeof state) => {
  state = next;
  for (const listener of listeners) listener();
};
export const worktreeLayoutDefault = {
  async load() {
    try {
      const template = readWorktreeLayoutTemplate(
        await native.loadWorkspaceLayout<unknown>(key),
      );
      publish({ ...state, saved: Boolean(template) });
      return template;
    } catch {
      return undefined;
    }
  },
  register(save?: () => WorktreeLayoutTemplate | undefined) {
    publish({ ...state, save });
    return () => {
      if (state.save === save) publish({ ...state, save: undefined });
    };
  },
  async save(t: (key: string) => string, reset = false) {
    try {
      const template = reset ? {} : state.save?.();
      if (!template) throw new Error("No layout");
      await native.saveWorkspaceLayout(key, template);
      publish({ ...state, saved: !reset });
      notices.show({
        key,
        text: t(
          reset ? "Reset to the default layout." : "Saved for new worktrees.",
        ),
      });
    } catch {
      notices.show({ key, text: t("Could not save the layout. Try again.") });
    }
  },
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useWorktreeLayoutDefault() {
  return useSyncExternalStore(subscribe, () => state);
}
