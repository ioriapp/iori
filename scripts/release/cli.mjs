if (process.argv.length === 2) await import("./service.mjs");
else if (process.argv.length === 3 && process.argv[2] === "invite")
  await import("./src/invite-cli.js");
else if (process.argv.length === 3 && process.argv[2] === "stop-terminals") {
  process.argv[2] = "--stop";
  await import("./terminal-daemon.mjs");
} else {
  process.stderr.write("使い方: iori-host [invite | stop-terminals]\n");
  process.exitCode = 1;
}
