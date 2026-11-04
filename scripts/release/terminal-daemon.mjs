import { storageRoot } from "./src/storage.js";
import {
  stopTerminalDaemon,
  terminalDaemonCanContinue,
} from "./src/terminal/daemon/launch.js";
if (process.argv[2] === "--stop") await stopTerminalDaemon(storageRoot());
else if (process.argv[2] === "--status")
  process.exitCode = (await terminalDaemonCanContinue(storageRoot())) ? 0 : 1;
else throw new Error("Use --status or --stop");
