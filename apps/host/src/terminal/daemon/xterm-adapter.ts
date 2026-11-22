// xterm's public APIs omit these parts of its parser and active buffer.
import type { IBufferLine, IBufferCell } from "@xterm/headless";
import type { IUnicodeVersionProvider } from "@xterm/xterm";

interface XtermCore {
  writeSync?: (data: string) => void;
  unicodeService?: { _providers?: Record<string, IUnicodeVersionProvider> };
  mouseStateService?: { activeEncoding?: string };
  coreService?: { kittyKeyboard?: { flags?: number } };
  buffer?: {
    savedX?: number;
    savedY?: number;
    savedOriginMode?: boolean;
    ybase?: number;
    scrollTop?: number;
    scrollBottom?: number;
  };
  _oscLinkService?: {
    _dataByLinkId?: { size?: number };
    getLinkData(id: number): { uri?: string } | undefined;
  };
}

function core(terminal: object) {
  return (terminal as { _core?: XtermCore })._core;
}

export function writeSynchronously(terminal: object, data: string) {
  const parser = core(terminal);
  if (!parser?.writeSync) return false;
  parser.writeSync(data);
  return true;
}

export const unicodeProvider = (terminal: object, version: string) =>
  core(terminal)?.unicodeService?._providers?.[version];
export const activeMouseEncoding = (terminal: object) =>
  core(terminal)?.mouseStateService?.activeEncoding;
export const activeBufferState = (terminal: object) => core(terminal)?.buffer;
export const kittyKeyboardFlags = (terminal: object) =>
  core(terminal)?.coreService?.kittyKeyboard?.flags ?? 0;

export function oscLinkLookup(terminal: object, hasRestoredLinks: boolean) {
  const service = core(terminal)?._oscLinkService;
  if (!service || (service._dataByLinkId?.size === 0 && !hasRestoredLinks))
    return undefined;
  return (id: number) => service.getLinkData(id)?.uri;
}

export function oscLinkId(
  line: IBufferLine,
  col: number,
  scratch: IBufferCell,
) {
  const cell = line.getCell(col, scratch) as
    | (IBufferCell & {
        extended?: { urlId?: number };
        hasExtendedAttrs?: () => boolean;
      })
    | undefined;
  return cell?.hasExtendedAttrs?.() ? (cell.extended?.urlId ?? 0) : 0;
}
