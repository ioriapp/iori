export type TerminalInputOptions = {
  /** Insert multi-line text safely without triggering Enter execution. */
  paste?: boolean;
};

/** Typing into an open Terminal from outside its View, such as a dropped path. */
const writers = new Map<
  string,
  (text: string, options?: TerminalInputOptions) => boolean
>();

const pendingInputs = new Map<
  string,
  Array<{ text: string; options?: TerminalInputOptions }>
>();

export function registerTerminalInput(
  terminalId: string,
  write: (text: string, options?: TerminalInputOptions) => boolean,
) {
  writers.set(terminalId, write);
  const queued = pendingInputs.get(terminalId);
  if (queued && queued.length > 0) {
    pendingInputs.delete(terminalId);
    for (const item of queued) {
      write(item.text, item.options);
    }
  }
  return () => {
    if (writers.get(terminalId) === write) writers.delete(terminalId);
  };
}

/** False when the Terminal is not open or cannot take input now. */
export const typeIntoTerminal = (
  terminalId: string,
  text: string,
  options?: TerminalInputOptions,
) => writers.get(terminalId)?.(text, options) ?? false;

/**
 * Types immediately if the Terminal view is mounted, or queues the input to be
 * delivered as soon as the Terminal mounts (for cross-worktree navigation).
 */
export function queueTerminalInput(
  terminalId: string,
  text: string,
  options?: TerminalInputOptions,
): boolean {
  const writer = writers.get(terminalId);
  if (writer) return writer(text, options);
  const list = pendingInputs.get(terminalId) ?? [];
  list.push({ text, options });
  pendingInputs.set(terminalId, list);
  return true;
}
