import { pathToFileURL } from "node:url";
import { command } from "../connection/build.mjs";
import { local } from "./local.mjs";
import { gate, sh } from "./remote.mjs";
import { lockEntry } from "./locks.mjs";

// apt itself waits for another package operation. Never remove its locks or
// stop a package manager owned by the OS or another task.
async function packageOperation(action, target) {
  gate({ devices: [local.linux.host], requireFreePorts: false });
  await command("ssh", [
    "-o",
    "BatchMode=yes",
    local.linux.host,
    `sudo apt-get -o DPkg::Lock::Timeout=-1 -y ${action} -- ${sh(target)}`,
  ]);
}
export const installLinuxVerificationPackage = (archive) =>
  packageOperation("install", archive);
export const removeLinuxVerificationPackage = (name) =>
  packageOperation("remove", name);

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await lockEntry(import.meta.url);
  if (process.argv[2] !== "--remove" || !process.argv[3])
    throw new Error("--remove <verification-package> を指定してください");
  await removeLinuxVerificationPackage(process.argv[3]);
}
