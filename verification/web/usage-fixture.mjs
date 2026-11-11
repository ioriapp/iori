import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Real Host definition scripts provide deterministic windows and record each read.
export async function prepareUsageFixture(dataRoot) {
  for (const [id, name, remaining] of [
    ["fixture-alpha", "Fixture Alpha", 75],
    ["fixture-beta", "Fixture Beta", 40],
  ]) {
    const folder = join(dataRoot, "iori-host", "cli-definitions", id);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "definition.json"),
      JSON.stringify({
        schema: 1,
        id,
        name,
        command: "node",
        usage: { script: "usage.mjs" },
      }),
    );
    await writeFile(
      join(folder, "usage.mjs"),
      `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(dataRoot, "iori-host", `${id}-reads`))}, 'read\\n');
process.stdout.write(JSON.stringify({ windows: [
  { remaining: ${remaining}, minutes: 300, resetsAt: Date.now() + 3600000 },
  { remaining: 90, minutes: 10080, resetsAt: Date.now() + 86400000 },
] }));
`,
    );
  }
}
