/** Read the key-value fields of an OSC 7501 payload. */
export function osc7501Fields(data: string): Map<string, string> | undefined {
  if (!data) return undefined;
  const fields = new Map<string, string>();
  for (const part of data.split(":")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return undefined;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return fields;
}
