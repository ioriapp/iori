import { spawn } from "node:child_process";

export async function apkContainsSource(apk, source) {
  const child = spawn(
    "unzip",
    ["-p", apk, "lib/arm64-v8a/libiori_client_lib.so"],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`)),
    );
  });
  const expected = Buffer.from(source);
  let tail = Buffer.alloc(0);
  let found = false;
  for await (const chunk of child.stdout) {
    const bytes = Buffer.concat([tail, chunk]);
    found ||= bytes.includes(expected);
    tail = bytes.subarray(-expected.length);
  }
  await finished;
  return found;
}
