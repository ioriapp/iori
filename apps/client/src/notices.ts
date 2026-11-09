import { useSyncExternalStore } from "react";

export type Notice = {
  key: string;
  text: string;
  title?: string;
  titleName?: { text: string; at: number };
  action?: { label: string; run: () => void };
  persistent?: boolean;
  removalFailure?: boolean;
  items?: {
    name?: string;
    reason: string;
    stopped?: string;
    gitOutput?: string;
  }[];
  detail?: { open: () => void };
  dismissible?: boolean;
  onClose?: () => void;
};

let state: Notice[] = [];
const listeners = new Set<() => void>();
function publish(next: Notice[]) {
  state = next;
  for (const listener of listeners) listener();
}

export const notices = {
  show(notice: Notice): void {
    const index = state.findIndex((item) => item.key === notice.key);
    publish(
      index < 0
        ? [...state, notice]
        : state.map((item, at) => (at === index ? notice : item)),
    );
  },
  dismiss(key: string): void {
    publish(state.filter((item) => item.key !== key));
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): Notice[] => state,
};

export function useNotices(): Notice[] {
  return useSyncExternalStore(notices.subscribe, notices.getSnapshot);
}
