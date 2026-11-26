export function zoomScrollOffset({
  boxSize,
  extent,
  padding,
  currentScale,
  nextScale,
  scroll,
  point,
}: {
  boxSize: number;
  extent: number;
  padding: number;
  currentScale: number;
  nextScale: number;
  scroll: number;
  point: number;
}): number {
  const offset = (scale: number) =>
    padding + Math.max(0, (boxSize - extent * scale) / 2);
  const imagePoint = (scroll + point - offset(currentScale)) / currentScale;
  return Math.max(0, imagePoint * nextScale + offset(nextScale) - point);
}
