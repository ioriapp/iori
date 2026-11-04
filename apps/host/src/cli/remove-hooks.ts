import { removeCliHooks } from "./hook-install.ts";
import { discoverShells } from "../terminal/platform.ts";
import { storageRoot } from "../storage.ts";
const shells = await discoverShells();
const shell = shells.shells.find((item) => item.id === shells.preferred);
if (!shell) throw new Error("A login shell is required to remove CLI hooks");
// The Host whose storage this environment names, as the Host itself finds it.
await removeCliHooks(shell, storageRoot());
