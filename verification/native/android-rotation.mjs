import { spawn } from "node:child_process";
import { adb, gate } from "./remote.mjs";

const keys = ["accelerometer_rotation", "user_rotation"];
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
let child;
let interrupted;
for (const signal of signals)
  process.on(signal, () => {
    interrupted ??= signal;
    child?.kill(signal);
  });

gate({ devices: ["android"], requireFreePorts: false });
const original = Object.fromEntries(
  keys.map((key) => [key, adb(["shell", "settings", "get", "system", key])]),
);
try {
  if (!interrupted) {
    child = spawn(process.argv[2], process.argv.slice(3), { stdio: "inherit" });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    process.exitCode = interrupted ? 1 : result;
  } else process.exitCode = 1;
} finally {
  for (const key of keys) {
    try {
      adb(
        original[key] === "null"
          ? ["shell", "settings", "delete", "system", key]
          : ["shell", "settings", "put", "system", key, original[key]],
      );
    } catch (error) {
      console.error(`[locks] 回転設定 ${key} の復元に失敗: ${error.message}`);
    }
  }
  for (const key of keys) {
    try {
      const actual = adb(["shell", "settings", "get", "system", key]);
      if (actual !== original[key])
        console.error(
          `[locks] 回転設定 ${key} の復元に失敗: ${original[key]} → ${actual}`,
        );
    } catch (error) {
      console.error(`[locks] 回転設定 ${key} の確認に失敗: ${error.message}`);
    }
  }
}
