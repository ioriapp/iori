import type { ILinkDecorations, Terminal } from "@xterm/xterm";

/** How a pointer opens output links; finger taps always open them. */
export type TerminalLinkOpen = "click" | "ctrlClick";

/** What the left button saw when it went down on the terminal. */
export type LinkPress = {
  /** Focus was in this Terminal, so the click was not only moving focus here. */
  focused: boolean;
  /** Text was selected; this click clears it instead of opening. */
  selected: boolean;
  /** The browser's click count: 2 and 3 select a word and a line. */
  clicks: number;
};

type Modifiers = Pick<
  MouseEvent,
  "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

/** Ctrl alone opens a link; Alt and Shift keep xterm's own clicks. */
function ctrlOnly(event: Modifiers) {
  return event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

function unmodified(event: Modifiers) {
  return !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

/** Whether a link may look clickable (underline and hand cursor) now. */
export function linkLooksClickable(
  mode: TerminalLinkOpen,
  ctrlKey: boolean,
  state: { focused: boolean; selected: boolean },
) {
  return ctrlKey || (mode === "click" && state.focused && !state.selected);
}

/** The single rule for opening an output URL or path with the mouse. */
export function linkClickOpens(
  event: Pick<MouseEvent, "button"> & Modifiers,
  state: {
    mode: TerminalLinkOpen;
    /** Text is selected when the button comes up, as after a drag. */
    selected: boolean;
    press?: LinkPress;
  },
) {
  if (event.button !== 0) return false;
  if (ctrlOnly(event)) return true;
  if (state.mode !== "click" || !unmodified(event)) return false;
  const press = state.press;
  return (
    !!press &&
    press.focused &&
    !press.selected &&
    press.clicks <= 1 &&
    !state.selected
  );
}

type LinkifierTerminal = {
  _core?: {
    linkifier?: {
      currentLink?: { link: { decorations?: ILinkDecorations } };
    };
  };
};

/** The link under the pointer. xterm keeps it internal; its decorations are
 * setters that redraw the underline and cursor of the hovered link. */
export function hoveredLink(terminal: Terminal) {
  return (terminal as unknown as LinkifierTerminal)._core?.linkifier
    ?.currentLink?.link;
}
