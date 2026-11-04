/** SemVer precedence; build metadata does not affect update availability. */
export function compareVersions(left: string, right: string): number {
  const split = (value: string) => {
    const [core, ...pre] = value.split("+", 1)[0]!.split("-");
    return { core: core!.split(".").map(Number), pre: pre.join("-") };
  };
  const a = split(left),
    b = split(right);
  for (let i = 0; i < 3; i++) {
    const difference = a.core[i]! - b.core[i]!;
    if (difference) return difference;
  }
  if (!a.pre || !b.pre) return a.pre === b.pre ? 0 : a.pre ? -1 : 1;
  const ap = a.pre.split("."),
    bp = b.pre.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i],
      y = bp[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
