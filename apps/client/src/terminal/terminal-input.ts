/** Typing into an open Terminal from outside its View, such as a dropped path. */
const writers = new Map<string, (text: string) => boolean>();

export function registerTerminalInput(
  terminalId: string,
  write: (text: string) => boolean,
) {
  writers.set(terminalId, write);
  return () => {
    if (writers.get(terminalId) === write) writers.delete(terminalId);
  };
}

/** False when the Terminal is not open or cannot take input now. */
export const typeIntoTerminal = (terminalId: string, text: string) =>
  writers.get(terminalId)?.(text) ?? false;
