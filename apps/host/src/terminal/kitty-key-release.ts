/** A CLI can exit between key-down and key-up. The shell did not negotiate
 * kitty event types (bit 2), so that stale release must not become shell input. */
export function filterKittyKeyReleases(data: string, flags: number): string {
  if (flags & 2) return data;
  return data.replace(/\u001b\[[0-9:]+;[0-9]+:3(?:;[0-9:]*)?u/gu, "");
}
