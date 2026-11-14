import { cliTitle } from "../cli/title.ts";
import { parseFileUriPath } from "./daemon/osc7-file-uri.ts";
import type { OscEvent } from "./daemon/parser-events.ts";

/** Interpret the same OSC metadata during output, reconnect and daemon replacement. */
export function applyTerminalMetadata(
  record: { cwd: string; title: string },
  events: OscEvent[],
  fallback: string,
): boolean {
  let cwdReported = false;
  for (const event of events) {
    if (event.number === 7) {
      const cwd = parseFileUriPath(event.data);
      if (cwd !== null) {
        record.cwd = cwd;
        cwdReported = true;
      }
    } else if (event.number === 0 || event.number === 2) {
      record.title = cliTitle(
        event.data,
        fallback,
        process.platform === "win32",
      );
    }
  }
  return cwdReported;
}
