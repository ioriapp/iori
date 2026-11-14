import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { constants, watch, type FSWatcher } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  opendir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import terminalNative from "@iori/terminal-native";
import { commandCredentials } from "./command-auth.ts";
import { CommandDirectories } from "./command-directory.ts";

export type Caller = { conversation: string; child?: string };
export type CommandResult = { ok: boolean; text: string; data?: unknown };
export function commandFailure(error: unknown): CommandResult {
  return {
    ok: false,
    text: error instanceof Error ? error.message : "iori command failed.",
  };
}
async function commandBase(base?: string): Promise<string> {
  if (!base) return tmpdir();
  try {
    await mkdir(base, { recursive: true, mode: 0o700 });
    const info = await lstat(base);
    if (info.isSymbolicLink() || !info.isDirectory()) return tmpdir();
    if (process.platform === "win32") {
      // The ACL helper checks ownership before restricting an existing base.
      terminalNative.restrictToCurrentUser(base, true);
    } else if (info.uid !== process.getuid!() || (info.mode & 0o022) !== 0) {
      return tmpdir();
    }
    return base;
  } catch {
    // An untrusted or inaccessible CLI temp base must not stop the team.
    return tmpdir();
  }
}
interface CommandRoute {
  secret: Buffer;
  caller: Caller;
  directory: string;
  watcher: FSWatcher;
  pending: Set<Promise<void>>;
  reading: Set<string>;
  scan?: Promise<void>;
  retired: boolean;
  changed: boolean;
}
/** A per-session mailbox in the CLI's writable temp area. Credentials never
 * enter argv, stored team records, terminal input/output, or error messages. */
export class CommandReceiver {
  readonly #routes = new Map<string, CommandRoute>();
  readonly #cleanup = new Set<Promise<void>>();
  #commands?: CommandDirectories;
  readonly execute: (caller: Caller, argv: unknown) => Promise<CommandResult>;
  constructor(
    execute: (caller: Caller, argv: unknown) => Promise<CommandResult>,
  ) {
    this.execute = execute;
  }
  async listen(root: string): Promise<void> {
    this.#commands = new CommandDirectories(root);
    await this.#commands.initialize();
  }
  async register(
    caller: Caller,
    base?: string,
  ): Promise<{ env: Record<string, string>; dispose: () => void }> {
    const directory = await mkdtemp(
      join(await commandBase(base), "iori-team-"),
    );
    if (process.platform === "win32")
      terminalNative.restrictToCurrentUser(directory);
    else await chmod(directory, 0o700);
    await this.#commands!.create(directory);
    const bin =
      process.platform === "win32"
        ? directory
        : dirname(fileURLToPath(import.meta.resolve("@iori/terminal-native")));
    const session = randomUUID();
    const secret = randomBytes(32);
    const route: CommandRoute = {
      caller,
      secret,
      directory,
      watcher: watch(directory, () => void this.#scan(route)),
      pending: new Set(),
      reading: new Set(),
      retired: false,
      changed: false,
    };
    route.watcher.on("error", () => {});
    this.#routes.set(session, route);
    const path = process.env.PATH ?? process.env.Path ?? "";
    return {
      env: {
        IORI_COMMAND_BIN: bin,
        PATH: bin + delimiter + path,
        IORI_COMMAND_DIRECTORY: directory,
        IORI_TEAM_FILES_DIRECTORY: this.#commands!.deliveryDirectory(directory),
        IORI_COMMAND_SESSION: session,
        IORI_COMMAND_AUTH: secret.toString("hex"),
      },
      dispose: () => {
        this.#routes.delete(session);
        secret.fill(0);
        this.#retire(route);
      },
    };
  }
  #scan(route: CommandRoute): Promise<void> {
    route.changed = true;
    if (route.scan) return route.scan;
    const scan = this.#scanDirectory(route);
    route.scan = scan;
    void scan.finally(() => {
      route.scan = undefined;
    });
    return scan;
  }
  async #scanDirectory(route: CommandRoute): Promise<void> {
    try {
      do {
        route.changed = false;
        const directory = await opendir(route.directory);
        for await (const entry of directory) {
          if (route.retired) break;
          const file = entry.name;
          if (
            !/^[a-f0-9-]{36}\.request\.json$/u.test(file) ||
            route.reading.has(file)
          )
            continue;
          route.reading.add(file);
          // Authenticate one file at a time: file count and body size cannot
          // create an unbounded set of simultaneous reads or retained bodies.
          let authenticated = false;
          try {
            authenticated = await this.#authenticate(route, file);
          } catch {
            // A removed/retired request does not stop the remaining mailbox.
          }
          if (authenticated && !route.retired) {
            const pending = this.#respond(route, file);
            route.pending.add(pending);
            void pending.finally(() => {
              route.pending.delete(pending);
            });
          } else route.reading.delete(file);
        }
      } while (route.changed && !route.retired);
    } catch {
      // Session retirement removes the directory while a scan may be active.
    }
  }
  async #authenticate(route: CommandRoute, name: string): Promise<boolean> {
    const request = join(route.directory, name);
    const info = await lstat(request);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const file = await open(request, constants.O_RDONLY | constants.O_NONBLOCK);
    let authenticated = false;
    try {
      if ((await file.stat()).isFile()) {
        const credentials = await commandCredentials(file);
        authenticated = this.#authenticatedRoute(credentials) !== undefined;
      }
    } finally {
      await file.close();
    }
    if (!authenticated) {
      try {
        await this.#writeResponse(request, {
          ok: false,
          text: "Unauthorized iori call.",
        });
      } finally {
        await rm(request);
      }
    }
    return authenticated;
  }
  async #writeResponse(request: string, result: CommandResult): Promise<void> {
    const response = request.replace(/\.request\.json$/u, ".response.json");
    await writeFile(response + ".tmp", JSON.stringify(result), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(response + ".tmp", response);
  }
  async #respond(route: CommandRoute, file: string): Promise<void> {
    const request = join(route.directory, file);
    try {
      const info = await lstat(request);
      if (!info.isFile() || info.isSymbolicLink()) return;
      const input = await readFile(request, "utf8");
      const result = await this.#handle(input);
      await this.#writeResponse(request, result);
    } catch {
      // Never dump the request envelope or overwrite a pre-existing temp file.
    } finally {
      // Absence of both request and response signals publish failure to iori.
      // If removal fails, keep it marked as reading so it cannot execute again.
      await rm(request, { force: true }).then(
        () => route.reading.delete(file),
        () => {},
      );
    }
  }
  async #handle(input: string): Promise<CommandResult> {
    let envelope: { session?: unknown; auth?: unknown; argv?: unknown };
    try {
      envelope = JSON.parse(input);
    } catch {
      return { ok: false, text: "Unauthorized iori call." };
    }
    const route = this.#authenticatedRoute(envelope);
    if (!route) return { ok: false, text: "Unauthorized iori call." };
    try {
      return await this.execute(route.caller, envelope.argv);
    } catch (error) {
      return commandFailure(error);
    }
  }
  #authenticatedRoute(envelope: {
    session?: unknown;
    auth?: unknown;
  }): CommandRoute | undefined {
    if (
      !envelope ||
      typeof envelope.session !== "string" ||
      typeof envelope.auth !== "string" ||
      !/^[a-f0-9]{64}$/u.test(envelope.auth)
    )
      return undefined;
    const route = this.#routes.get(envelope.session);
    if (
      !route ||
      !timingSafeEqual(route.secret, Buffer.from(envelope.auth, "hex"))
    )
      return undefined;
    return route;
  }
  #retire(route: CommandRoute): void {
    route.retired = true;
    route.watcher.close();
    const cleanup = (async () => {
      await route.scan;
      await Promise.all(route.pending);
      await this.#commands!.remove(route.directory);
    })();
    this.#cleanup.add(cleanup);
    void cleanup.catch(() => {}).finally(() => this.#cleanup.delete(cleanup));
  }
  async close(): Promise<void> {
    for (const route of this.#routes.values()) {
      route.secret.fill(0);
      this.#retire(route);
    }
    this.#routes.clear();
    await Promise.all(this.#cleanup);
  }
}
