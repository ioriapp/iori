import { spawn, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  lstat,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fetchMain, checkoutSource, prepareDependencies } from "./source.mjs";

const root = join(homedir(), ".local/share/iori-cli-compat");
const repo = join(root, "repo");
const startedAt = new Date().toISOString();
const evidence = join(
  root,
  "evidence",
  `preparation-${startedAt.replaceAll(":", "-")}`,
);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const env = { ...process.env };
for (const name of Object.keys(env))
  if (name === "CLAUDECODE" || name.startsWith("CLAUDE_CODE_"))
    delete env[name];
let stage = "source";
let sha = "unknown";
let tools;

const redact = (text) =>
  text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gu, "$1[redacted]@");
function command(file, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      appendFileSync(
        join(evidence, "preparation.log"),
        redact(Buffer.concat(chunks).toString()),
        { mode: 0o600 },
      );
      if (code === 0) resolve();
      else reject(new Error(`${file} ${args.join(" ")}: ${signal ?? code}`));
    });
  });
}
const output = (file, args, cwd) =>
  execFileSync(file, args, { cwd, env, encoding: "utf8" }).trim();
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
try {
  if (
    (await realpath(process.cwd())) !== repo ||
    (await realpath(repo)) !== repo ||
    !(await lstat(join(repo, ".git"))).isDirectory()
  )
    throw new Error("Compatibility preparation requires its dedicated clone");
  if (process.versions.node.split(".")[0] !== "24")
    throw new Error("Node 24 is required");
  sha = await fetchMain(command, output, repo);
  await checkoutSource(command, repo, sha);
  stage = "dependencies";
  const corepack = await realpath(join(dirname(process.execPath), "corepack"));
  await mkdir(join(repo, ".local"), { recursive: true });
  tools = await mkdtemp(join(repo, ".local/node-tools-"));
  await writeFile(
    join(tools, "pnpm"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(corepack)} pnpm "$@"\n`,
    { mode: 0o700 },
  );
  env.PATH = `${tools}:${dirname(process.execPath)}:${env.PATH}`;
  env.CI = "1";
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
  // Keep pnpm and its native build scripts on this entry's Node, like prepare-linux.mjs.
  await prepareDependencies(command, repo, {
    beforeNative: async () => {
      await command("pnpm", ["rebuild", "node-pty"], repo);
      stage = "native";
    },
  });
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        sha,
        preparation: { status: "passed" },
        evidence,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
} catch (error) {
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sha,
    clis: [],
    failed: [],
    evidence,
    preparation: { status: "failed", stage, error: redact(error.message) },
  };
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  const temporary = join(root, `latest-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, join(root, "latest.json"));
  console.error(
    `Compatibility preparation failed (${stage}). Evidence: ${evidence}`,
  );
  process.exitCode = 1;
} finally {
  if (tools) await rm(resolve(tools), { recursive: true, force: true });
}
