import { removeHookFile } from "../hook-files.ts";
// hooks/list → config/batchWrite follows Orca codex-app-server-client.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { object, type HookInstallContext } from "../hooks.ts";
import { writeText } from "../hook-config.ts";
import { shellDialect } from "../shell-command.ts";

export async function trustHooks(
  ctx: HookInstallContext,
  directory: string,
): Promise<void> {
  const dialect = shellDialect(ctx.shell);
  const script = `${ctx.cliCommand} app-server`;
  const args =
    dialect === "powershell"
      ? ["-NoLogo", "-NonInteractive", "-Command", script]
      : dialect === "cmd"
        ? ["/s", "/c", `"${script}"`]
        : ["-l", "-i", "-c", script];
  const child = spawn(ctx.shell.executable, args, {
    cwd: ctx.home,
    env: { ...process.env, CODEX_HOME: directory },
    windowsHide: true,
    signal: ctx.signal,
    stdio: ["pipe", "pipe", "ignore"],
    ...(dialect === "cmd" ? { windowsVerbatimArguments: true } : {}),
  });
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  let nextId = 0;
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.on("error", fail);
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => {
      fail(new Error("Codex hook trust process exited"));
      resolve();
    }),
  );
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let response: Record<string, unknown>;
    try {
      response = object(JSON.parse(line));
    } catch {
      return;
    }
    if (typeof response.id !== "number") return;
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.error)
      waiter.reject(new Error("Codex hook trust request failed"));
    else waiter.resolve(response.result);
  });
  const request = (method: string, params: unknown): Promise<unknown> => {
    if (failure) return Promise.reject(failure);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  try {
    await request("initialize", {
      clientInfo: { name: "iori-hooks", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    const listed = object(await request("hooks/list", { cwds: [ctx.home] }));
    const value: Record<string, { trusted_hash: string }> = {};
    const ownedKeys = new Map<string, string>();
    const manifest = join(directory, "iori-hook-trust.json");
    try {
      for (const raw of JSON.parse(await readFile(manifest, "utf8"))) {
        const entry = object(raw);
        if (typeof entry.key === "string" && typeof entry.hash === "string")
          ownedKeys.set(entry.key, entry.hash);
      }
    } catch (error) {
      if (object(error).code !== "ENOENT") throw error;
    }
    const source = join(directory, "hooks.json");
    const sources = [source, await realpath(source)].map((path) =>
      path.replaceAll("\\", "/"),
    );
    for (const entry of Array.isArray(listed.data) ? listed.data : []) {
      for (const raw of Array.isArray(object(entry).hooks)
        ? (object(entry).hooks as unknown[])
        : []) {
        const hook = object(raw);
        if (
          hook.command !== ctx.command ||
          typeof hook.key !== "string" ||
          typeof hook.currentHash !== "string"
        )
          continue;
        // Restrict writes to the owned user hooks, including their exact source.
        if (
          !sources.some((source) =>
            (hook.key as string).replaceAll("\\", "/").startsWith(`${source}:`),
          )
        )
          continue;
        ownedKeys.set(hook.key, hook.currentHash);
        if (hook.trustStatus !== "trusted")
          value[hook.key] = { trusted_hash: hook.currentHash };
      }
    }
    if (Object.keys(value).length)
      await request("config/batchWrite", {
        edits: [{ keyPath: "hooks.state", value, mergeStrategy: "upsert" }],
        reloadUserConfig: true,
      });
    // Retain only the keys granted by iori, so removal cannot touch user trust.
    await writeText(
      manifest,
      JSON.stringify([...ownedKeys].map(([key, hash]) => ({ key, hash }))) +
        "\n",
    );
  } finally {
    lines.close();
    child.stdin.end();
    child.kill();
    await closed;
  }
}

export async function removeTrust(directory: string): Promise<void> {
  const manifest = join(directory, "iori-hook-trust.json");
  let keys: unknown;
  try {
    keys = JSON.parse(await readFile(manifest, "utf8"));
  } catch (error) {
    if (object(error).code === "ENOENT") return;
    throw error;
  }
  const path = join(directory, "config.toml");
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (object(error).code !== "ENOENT") throw error;
  }
  if (content !== undefined) {
    const headers = new Map<string, string>();
    for (const raw of Array.isArray(keys) ? keys : []) {
      const entry = object(raw);
      if (typeof entry.key === "string" && typeof entry.hash === "string")
        headers.set(`[hooks.state.${JSON.stringify(entry.key)}]`, entry.hash);
    }
    const sourceLines = content.split("\n");
    const lines: string[] = [];
    for (let index = 0; index < sourceLines.length;) {
      const line = sourceLines[index];
      const expected = headers.get(line.trim());
      if (!expected) {
        lines.push(line);
        index++;
        continue;
      }
      let end = index + 1;
      while (
        end < sourceLines.length &&
        !sourceLines[end].trim().startsWith("[")
      )
        end++;
      const body = sourceLines.slice(index + 1, end);
      const trusted = body
        .map(
          (line) =>
            /^\s*trusted_hash\s*=\s*("[^"\n]*"|'[^'\n]*')/u.exec(line)?.[1],
        )
        .find(Boolean);
      const actual = trusted?.slice(1, -1);
      // A displaced key can now belong to a user hook; do not revoke that trust.
      if (actual !== expected) lines.push(...sourceLines.slice(index, end));
      else
        for (const item of body) {
          const trimmed = item.trim();
          if (!trimmed || trimmed.startsWith("#")) lines.push(item);
          else {
            const comment = /^(?:[^"']|"[^"\n]*"|'[^'\n]*')*?(#.*)$/u.exec(
              item,
            )?.[1];
            if (comment) lines.push(comment);
          }
        }
      index = end;
    }
    await writeText(path, lines.join("\n"));
  }
  await removeHookFile(manifest);
}
