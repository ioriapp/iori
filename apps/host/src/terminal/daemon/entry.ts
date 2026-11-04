import { runTerminalDaemon } from "./server.ts";
const [root, endpoint] = process.argv.slice(2);
if (!root || !endpoint)
  throw new Error("Terminal daemon requires its storage and endpoint");
await runTerminalDaemon(root, endpoint);
