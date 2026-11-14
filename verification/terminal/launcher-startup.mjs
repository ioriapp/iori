import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { stopHostScript } from "../../scripts/release/stop-windows.mjs";
import { writeWindows } from "../connection/build.mjs";
import { windows, ps, windowsBuildNode } from "../native/remote.mjs";

// The real launcher must restart after installer cleanup and preserve startup
// failures even when its optional error file can no longer be written.
export async function verifyLauncherStartup(root, evidence) {
  windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
  for (const [destination, source] of [
    [
      "launcher.cs",
      new URL("../../scripts/release/launcher.cs", import.meta.url),
    ],
    ["probe.ps1", new URL("./launcher-startup.ps1", import.meta.url)],
  ])
    await writeWindows(root + "\\" + destination, await readFile(source));
  const previousLauncher = process.argv
    .find((argument) => argument.startsWith("--previous-launcher="))
    ?.slice(20);
  let previousLauncherSha256;
  if (previousLauncher) {
    const bytes = await readFile(previousLauncher);
    previousLauncherSha256 = createHash("sha256").update(bytes).digest("hex");
    await writeWindows(root + "\\previous-launcher.exe", bytes);
    await writeWindows(
      root + "\\stop.ps1",
      stopHostScript(root).replaceAll("/", "\\"),
    );
  }
  const result = JSON.parse(
    windows(
      `& ${ps(root + "\\probe.ps1")} -Root ${ps(root)} -Node ${ps(windowsBuildNode)}`,
      { diagnosticStdout: true },
    ),
  );
  if (previousLauncherSha256)
    result.previousLauncherSha256 = previousLauncherSha256;
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify({ evidence, ...result }));
  assert.equal(result.passed, true, result.error);
}
