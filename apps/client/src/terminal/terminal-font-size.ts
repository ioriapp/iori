export const TERMINAL_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18] as const;

export function pinchedTerminalFontSize(
  startSize: number,
  ratio: number,
): number {
  const requested = startSize * ratio;
  return TERMINAL_FONT_SIZES.reduce((nearest, size) =>
    Math.abs(size - requested) < Math.abs(nearest - requested) ? size : nearest,
  );
}
