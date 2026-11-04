import type { ITheme } from "@xterm/xterm";

// Light+/Dark+ ANSI defaults from VS Code terminalColorRegistry.ts at
// microsoft/vscode cc3fec8846d0e678357e476fa611774da26d7e24.
export const DARK_ANSI_COLORS = {
  black: "#000000",
  red: "#cd3131",
  green: "#0DBC79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

export const LIGHT_ANSI_COLORS = {
  black: "#000000",
  red: "#cd3131",
  green: "#107C10",
  yellow: "#716e00",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#14CE14",
  brightYellow: "#7a7000",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#a5a5a5",
};

export const ANSI_COLOR_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const satisfies readonly (keyof ITheme)[];

function defaultExtendedAnsiColors(): string[] {
  const levels = [0, 95, 135, 175, 215, 255];
  const colors: string[] = [];
  for (const red of levels) {
    for (const green of levels) {
      for (const blue of levels) colors.push(rgbHex([red, green, blue]));
    }
  }
  for (let step = 0; step < 24; step++) {
    const value = 8 + step * 10;
    colors.push(rgbHex([value, value, value]));
  }
  return colors;
}

function rgbHex(rgb: readonly [number, number, number]) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export const DEFAULT_EXTENDED_ANSI_COLORS = defaultExtendedAnsiColors();

/** The 256 colors a Terminal shows, by palette index, for the light or dark theme. */
export function ansiPalette(dark: boolean): string[] {
  const colors = dark ? DARK_ANSI_COLORS : LIGHT_ANSI_COLORS;
  return [
    ...ANSI_COLOR_KEYS.map((key) => colors[key]),
    ...DEFAULT_EXTENDED_ANSI_COLORS,
  ];
}
