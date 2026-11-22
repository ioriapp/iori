// Derived from Orca terminal helpers. Copyright (c) 2026 Lovecast Inc.; see ../ORCA-LICENSE.txt for the MIT license.

import type { IBuffer, Terminal } from "@xterm/headless";
import type { TerminalOscLinkRange } from "../shared/terminal-osc-link-ranges.ts";

import { oscLinkId, oscLinkLookup } from "./xterm-adapter.ts";

export function collectHeadlessOscLinkRanges(
  terminal: Terminal,
  scrollbackRows: number | undefined,
  restoredLinks: TerminalOscLinkRange[] = [],
): TerminalOscLinkRange[] {
  const buffer = terminal.buffer.active;
  const startRow =
    scrollbackRows === undefined
      ? 0
      : Math.max(0, buffer.length - terminal.rows - scrollbackRows);
  return collectOscLinkRangesInRows(
    terminal,
    buffer,
    startRow,
    buffer.length,
    restoredLinks,
  );
}

/** Links in normal-buffer rows [0, endRow), whichever buffer is active. */
export function collectNormalBufferOscLinkRanges(
  terminal: Terminal,
  endRow: number,
): TerminalOscLinkRange[] {
  const buffer = terminal.buffer.normal;
  return collectOscLinkRangesInRows(
    terminal,
    buffer,
    0,
    Math.min(endRow, buffer.length),
    [],
  );
}

function collectOscLinkRangesInRows(
  terminal: Terminal,
  buffer: IBuffer,
  startRow: number,
  endRow: number,
  restoredLinks: TerminalOscLinkRange[],
): TerminalOscLinkRange[] {
  // Empty registries need no per-cell scan.
  const uriFor = oscLinkLookup(terminal, restoredLinks.length > 0);
  if (!uriFor) return [];
  const ranges: TerminalOscLinkRange[] = [];
  // Why one cell for the whole walk: xterm's getCell allocates a fresh CellData
  // per call unless handed a target, which is a per-cell allocation across the
  // entire scrollback. See the IBufferLine.getCell docs.
  const scratchCell = buffer.getNullCell();
  for (let row = startRow; row < endRow; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    const lineLength = Math.min(terminal.cols, line.length);
    let currentUrlId = 0;
    let currentStart = -1;
    for (let col = 0; col <= lineLength; col += 1) {
      const urlId = col < lineLength ? oscLinkId(line, col, scratchCell) : 0;
      if (urlId === currentUrlId) {
        continue;
      }
      if (currentUrlId && currentStart >= 0) {
        const uri = uriFor(currentUrlId);
        if (uri) {
          ranges.push({
            row: row - startRow,
            startCol: currentStart,
            endCol: col,
            uri,
          });
        }
      }
      currentUrlId = urlId;
      currentStart = urlId ? col : -1;
    }
  }
  for (const link of restoredLinks) {
    if (link.row < startRow || link.row >= endRow) {
      continue;
    }
    const startCol = Math.max(0, Math.min(terminal.cols, link.startCol));
    const endCol = Math.max(0, Math.min(terminal.cols, link.endCol));
    if (startCol >= endCol) {
      continue;
    }
    ranges.push({
      row: link.row - startRow,
      startCol,
      endCol,
      uri: link.uri,
    });
  }
  return dedupeOscLinkRanges(ranges);
}

function dedupeOscLinkRanges(
  ranges: TerminalOscLinkRange[],
): TerminalOscLinkRange[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.row}:${range.startCol}:${range.endCol}:${range.uri}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
