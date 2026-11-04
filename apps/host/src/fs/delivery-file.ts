import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { writeFileAtomic } from "./atomic-write.ts";

/** Keep the canonical record private; the CLI reads only its route's copy. */
export async function copyDeliveryFile(
  file: string,
  directory: string,
  content?: string,
): Promise<string> {
  const destination = join(directory, basename(file));
  await writeFileAtomic(destination, content ?? (await readFile(file, "utf8")));
  return destination;
}
