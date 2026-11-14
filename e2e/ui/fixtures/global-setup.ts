import { fork } from "node:child_process";

export default async function setup() {
  const child = fork(new URL("./web.mjs", import.meta.url), [], {
    execArgv: [],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Web server exited (${code})`)),
    );
  });
  void exited.catch(() => {});
  process.env.IORI_UI_WEB_URL = await Promise.race([
    new Promise<string>((resolve) => child.once("message", resolve)),
    exited.then(() => {
      throw new Error("Web server exited before starting");
    }),
  ]);
  return async () => {
    child.send("stop");
    await exited;
  };
}
