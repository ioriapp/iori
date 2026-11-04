/** A Host path dragged from Files or Git, for a Terminal to type. */
export const PATH_DRAG_TYPE = "application/x-iori-path";
export type PathDrag = {
  hostKey: string;
  root: string;
  path: string;
  absolutePath: string;
};

export function writePathDrag(data: DataTransfer, value: PathDrag) {
  data.effectAllowed = "copy";
  data.setData(PATH_DRAG_TYPE, JSON.stringify(value));
  data.setData("text/plain", value.absolutePath);
}

export const carriesPath = (data: DataTransfer) =>
  data.types.includes(PATH_DRAG_TYPE);

export function readPathDrag(data: DataTransfer): PathDrag | undefined {
  try {
    const value = JSON.parse(data.getData(PATH_DRAG_TYPE)) as Partial<PathDrag>;
    return typeof value.hostKey === "string" &&
      typeof value.absolutePath === "string"
      ? (value as PathDrag)
      : undefined;
  } catch {
    return undefined;
  }
}
