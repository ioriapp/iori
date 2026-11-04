import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
const run = promisify(execFile);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
export async function prepareUnregister(unit) {
  const { stdout } = await run("systemctl", [
    "--user",
    "is-enabled",
    unit,
  ]).catch((error) => {
    if (error.stdout?.trim() === "disabled") return error;
    throw error;
  });
  return {
    remove: () => run("systemctl", ["--user", "disable", unit]),
    restore: async () => {
      if (stdout.trim() === "enabled")
        await run("systemctl", ["--user", "enable", unit]);
    },
  };
}
export async function launchRemoval(request) {
  const { status, receipt, bundle, storage, unit, backups } = request;
  const result = (phase, stage) =>
    JSON.stringify({
      hostKey: request.hostKey,
      status: {
        ...status,
        phase,
        ...(stage ? { stage, reason: "uninstall" } : {}),
        completed: [
          ...status.completed,
          ...(stage !== "stop" ? ["stop"] : []),
          ...(phase === "succeeded" || stage === "data" ? ["program"] : []),
          ...(phase === "succeeded" && status.deleteData ? ["data"] : []),
        ],
      },
    });
  const failedResult = (stage) =>
    quote(result("failed", stage).slice(0, -2) + ',"failedPaths":[') +
    '"$failed_paths"' +
    quote("]}}");
  const recordFailure = (folder) =>
    `failed_paths="$failed_paths$separator"${quote(JSON.stringify(folder))};separator=,`;
  const removeFolders = (folders) =>
    folders
      .map(
        (folder) =>
          `rm -rf -- ${quote(folder)} || { ${recordFailure(folder)}; }`,
      )
      .join("\n");
  const script = `umask 077
result=${quote(result("failed", "stop"))}
stopping=true
finish() { if [ "$stopping" = true ]; then printf '%s' ${quote(JSON.stringify(JSON.parse(result("failed", "stop")).status))} > ${quote(request.statusFile + ".tmp")} && mv -- ${quote(request.statusFile + ".tmp")} ${quote(request.statusFile)}; fi; printf '%s' "$result" > ${quote(receipt + ".tmp")} && mv -- ${quote(receipt + ".tmp")} ${quote(receipt)}; }
trap finish EXIT
unit_file=$(systemctl --user show -p FragmentPath --value ${quote(unit)}) || exit
systemctl --user stop ${quote(unit)} || exit
stopping=false
result=${quote(result("failed", "program"))}
rm -f -- ${quote(join(homedir(), ".local/bin/iori-host"))} "$unit_file" || exit
systemctl --user daemon-reload || exit
failed_paths=;separator=
${removeFolders([bundle, join(storage, "terminal-daemon"), join(storage, "team-command-bin")])}
${backups.map((folder) => `if [ -d ${quote(folder)} ]; then find ${quote(folder)} -mindepth 1 -maxdepth 1 ! -name database -exec rm -rf -- {} + || { ${recordFailure(folder)}; }; fi`).join("\n")}
if [ -n "$failed_paths" ]; then result=${failedResult("program")};exit 1;fi
${status.deleteData ? `result=${quote(result("failed", "data"))}\n${removeFolders([storage, ...backups])}\nif [ -n "$failed_paths" ]; then result=${failedResult("data")};exit 1;fi` : ""}
result=${quote(result("succeeded"))}
`;
  // The OS shell is outside the files being removed; no copied runtime remains.
  await run("systemd-run", [
    "--user",
    "--quiet",
    "--collect",
    `--unit=iori-host-uninstall-${request.id}`,
    "--property=Type=exec",
    "sh",
    "-c",
    script,
  ]);
}
