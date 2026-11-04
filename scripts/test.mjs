import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const files = globSync(
  [
    "packages/**/*.test.{js,mjs,cjs,ts,mts,cts}",
    "apps/**/*.test.{js,mjs,cjs,ts,mts,cts}",
    "scripts/**/*.test.{js,mjs,cjs,ts,mts,cts}",
    "verification/**/*.test.{js,mjs,cjs,ts,mts,cts}",
  ],
  {
    exclude: [
      "**/node_modules/**",
      "**/target/**",
      "**/gen/**",
      "**/.local/**",
    ],
  },
).sort();
if (files.length > 0) {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-timeout=60000", ...files],
    {
      stdio: "inherit",
      // Tests create their own Hosts and routes, not the invoking iori session.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !name.startsWith("IORI_"),
        ),
      ),
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write("試験ファイルはまだありません。\n");
}
