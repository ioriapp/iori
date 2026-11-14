import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./fs/atomic-write.ts";

export type ConnectionScope = "loopback" | "network";

export async function readConnectionScope(
  root: string,
): Promise<ConnectionScope> {
  try {
    const saved: { scope?: unknown } | null = JSON.parse(
      await readFile(join(root, "network.json"), "utf8"),
    );
    return saved?.scope === "network" ? "network" : "loopback";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "network";
    return "loopback";
  }
}

export async function allowNetworkConnections(root: string): Promise<void> {
  await writeFileAtomic(
    join(root, "network.json"),
    JSON.stringify({ scope: "network" }),
  );
}
