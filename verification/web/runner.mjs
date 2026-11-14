import {
  ownVerificationDirectory,
  registerCleanup,
  recoverStaleVerificationRuns,
} from "../lifecycle.mjs";
import { basicWebScenarios } from "./scenarios.mjs";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { stopVerificationUnitsUnder } from "../terminal/daemon-process.mjs";

export class WebRunCleanupError extends Error {}

async function preserveFailedCleanup(evidence) {
  try {
    for (const entry of await readdir(evidence, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
      try {
        const result = JSON.parse(
          await readFile(join(evidence, entry.name, "result.json"), "utf8"),
        );
        if (result.cleanup === false) return true;
      } catch (error) {
        // An OOM can leave no result; the outer owner still removes its data.
        if (error.code !== "ENOENT") throw error;
      }
    }
    return false;
  } catch (error) {
    console.error(
      `[release] 後始末の結果を読めないため保存先を保持: ${error.message}`,
    );
    return true;
  }
}

// This owner lives outside the bounded runner. Keep its data outside the source
// copy too, so an OOM cannot orphan a daemon when the build removes that copy.
export async function runWebScenario({
  cwd,
  host,
  scenario,
  evidence,
  env,
  realModels = false,
}) {
  await mkdir(evidence, { recursive: true });
  const definition = basicWebScenarios[scenario];
  await recoverStaleVerificationRuns();
  const runsRoot = await mkdtemp("/var/tmp/iori-web-runs-");
  await ownVerificationDirectory(runsRoot);
  const environment = { ...env };
  delete environment.FORGEJO_TOKEN;
  delete environment.IORI_MEMORY_EVIDENCE_PATH;
  const cleanup = registerCleanup(() => stopVerificationUnitsUnder(runsRoot));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "scripts/run-bounded-check.mjs",
          process.execPath,
          "verification/web/run.mjs",
          `--only=${scenario}`,
          ...(realModels ? ["--real-models"] : []),
        ],
        {
          cwd,
          stdio: "inherit",
          env: {
            ...environment,
            IORI_WEB_HOST_DISTRIBUTION: host,
            IORI_WEB_RUNS_ROOT: runsRoot,
            IORI_VERIFICATION_EVIDENCE_ROOT: evidence,
            ...(definition
              ? { IORI_MEMORY_EVIDENCE_PATH: join(evidence, "memory.json") }
              : {}),
          },
        },
      );
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`${scenario} exit ${signal ?? code}`)),
      );
    });
  } finally {
    // Failure to stop an owned daemon leaves its data available for recovery.
    try {
      await cleanup();
      if (await preserveFailedCleanup(evidence))
        console.log(`[release] 後始末の調査用に保存先を保持: ${runsRoot}`);
      else await rm(runsRoot, { recursive: true, force: true });
    } catch (error) {
      throw new WebRunCleanupError(
        `検証用Terminal係の後始末に失敗。保存先を保持: ${runsRoot}`,
        { cause: error },
      );
    }
    if (definition) {
      let found = false;
      for (const name of ["memory.json", "memory-oom.json"]) {
        try {
          const memory = JSON.parse(
            await readFile(join(evidence, name), "utf8"),
          );
          found = true;
          console.log(
            `[release] ${scenario} MemoryPeak=${memory.peakBytes} MemoryMax=${memory.limitBytes} evidence=${join(evidence, name)}`,
          );
        } catch (error) {
          if (error.code !== "ENOENT")
            console.error(
              `[release] MemoryPeakの記録を読めません: ${join(evidence, name)}: ${error.message}`,
            );
        }
      }
      if (!found)
        console.error(
          `[release] MemoryPeakの記録がありません: ${evidence}（記録失敗の理由は試験結果・実行ログを参照）`,
        );
    }
  }
}
