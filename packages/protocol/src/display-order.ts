/** Compare a definition's positions, then names for entries no longer defined. */
export function definitionOrder(names: readonly string[], language?: string) {
  const positions = new Map(names.map((name, index) => [name, index]));
  return (a: string, b: string): number =>
    (positions.get(a) ?? names.length) - (positions.get(b) ?? names.length) ||
    a.localeCompare(b, language);
}

/** Roles shared by teams use their earliest position, independent of records. */
export function roleOrder(
  teams: readonly { roles: readonly { name: string }[] }[],
  language?: string,
) {
  const positions = new Map<string, number>();
  for (const team of teams)
    team.roles.forEach((role, index) =>
      positions.set(
        role.name,
        Math.min(positions.get(role.name) ?? index, index),
      ),
    );
  return [...positions.keys()].sort(
    (a, b) =>
      positions.get(a)! - positions.get(b)! || a.localeCompare(b, language),
  );
}

export function creationOrder(
  a: { createdAt: number; id: string },
  b: { createdAt: number; id: string },
): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

export function nameOrder(
  a: { name: string; id: string },
  b: { name: string; id: string },
): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function worktreeOrder(
  a: { primary?: boolean; label?: string; branch?: string; path: string },
  b: { primary?: boolean; label?: string; branch?: string; path: string },
): number {
  const name = (item: typeof a) =>
    item.label ??
    item.branch ??
    item.path.split(/[\\/]/u).filter(Boolean).at(-1) ??
    item.path;
  return (
    Number(b.primary ?? false) - Number(a.primary ?? false) ||
    name(a).localeCompare(name(b)) ||
    a.path.localeCompare(b.path)
  );
}

/** Unpositioned entries retain their persisted creation order. */
export function sidebarOrder(ids: readonly string[]) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return (a: string, b: string) =>
    (positions.get(a) ?? ids.length) - (positions.get(b) ?? ids.length);
}
