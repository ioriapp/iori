import { readFile } from "node:fs/promises";
import { platform } from "node:os";

/** Undefined means no observation; it does not mean the CLI exited. */
export async function shellOwnsForeground(
  pid: number,
): Promise<boolean | undefined> {
  if (platform() !== "linux") return undefined;
  try {
    const line = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = line
      .slice(line.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/u);
    const group = Number(fields[2]);
    const foreground = Number(fields[5]);
    return group > 0 && foreground > 0 ? group === foreground : undefined;
  } catch {
    return undefined;
  }
}
