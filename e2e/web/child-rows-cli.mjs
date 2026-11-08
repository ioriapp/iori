import { createInterface } from "node:readline";
import { execFile } from "node:child_process";

console.log("Child rows parent ready");
createInterface({ input: process.stdin }).on("line", (line) => {
  try {
    const args = JSON.parse(line);
    execFile("iori", [...args, "--json"], (error, stdout) => {
      console.log(error ? error.message : stdout);
    });
  } catch (error) {
    console.error(error.message);
  }
});
