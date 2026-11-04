import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../fs/atomic-write.ts";

type Keyring = typeof import("@napi-rs/keyring");
export type TokenStorage = "os" | "file";

/**
 * Keep Forge tokens where gh keeps its own: the OS credential store when the
 * Host has one (Windows Credential Manager, Secret Service on Linux), else a
 * file in the Host's data folder that only this user can read.
 */
export class TokenVault {
  readonly #service: string;
  readonly #file: string;
  readonly #secure: (path: string) => Promise<void>;
  readonly #protect: (data: Buffer) => Buffer;
  readonly #unprotect: (data: Buffer) => Buffer;
  #keyring?: Promise<Keyring | undefined>;
  #available?: Promise<boolean>;
  #fileWrites: Promise<unknown> = Promise.resolve();
  constructor(options: {
    /** Separates the entries of several Hosts run by one OS user. */
    hostKey: string;
    root: string;
    secureFile: (path: string) => Promise<void>;
    protect: (data: Buffer) => Buffer;
    unprotect: (data: Buffer) => Buffer;
  }) {
    this.#service = `iori-host:${options.hostKey}`;
    this.#file = join(options.root, "forge-tokens");
    this.#secure = options.secureFile;
    this.#protect = options.protect;
    this.#unprotect = options.unprotect;
  }

  async #entry(origin: string) {
    // Loaded on first use: without a usable binding the Host keeps running
    // and keeps tokens in the file.
    this.#keyring ??= import("@napi-rs/keyring").catch(() => undefined);
    const keyring = await this.#keyring;
    if (!keyring) throw new Error("No OS credential store");
    // Requiring Secret Service stops the binding's silent fallback to the
    // kernel keyring, which loses every token at the next reboot.
    return new keyring.AsyncEntry(this.#service, origin, {
      linux: { store: "secret-service" },
    });
  }

  /** Where a new token goes. Opening the store does not write to it. */
  async storage(): Promise<TokenStorage> {
    this.#available ??= this.#entry(this.#service).then(
      () => true,
      () => false,
    );
    return (await this.#available) ? "os" : "file";
  }

  async write(origin: string, token: string): Promise<TokenStorage> {
    if ((await this.storage()) === "os") {
      try {
        await (await this.#entry(origin)).setPassword(token);
        return "os";
      } catch {
        // Like gh, a store that refuses the token leaves it in the file.
      }
    }
    await this.#updateFile((tokens) => {
      tokens[origin] = token;
    });
    return "file";
  }

  async read(
    origin: string,
    storage: TokenStorage,
  ): Promise<string | undefined> {
    if (storage === "os")
      return (await (await this.#entry(origin)).getPassword()) ?? undefined;
    return (await this.#readFile())[origin];
  }

  async delete(origin: string, storage: TokenStorage): Promise<void> {
    if (storage === "os") await (await this.#entry(origin)).deletePassword();
    else
      await this.#updateFile((tokens) => {
        delete tokens[origin];
      });
  }

  async #readFile(): Promise<Record<string, string>> {
    let saved: string;
    try {
      saved = await readFile(this.#file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    return JSON.parse(
      this.#unprotect(Buffer.from(saved, "base64")).toString("utf8"),
    ) as Record<string, string>;
  }

  #updateFile(change: (tokens: Record<string, string>) => void) {
    const update = this.#fileWrites.then(async () => {
      const tokens = await this.#readFile();
      change(tokens);
      await writeFileAtomic(
        this.#file,
        // Windows encrypts it for this user (DPAPI); elsewhere 0600 is the guard.
        this.#protect(Buffer.from(JSON.stringify(tokens))).toString("base64"),
      );
      await this.#secure(this.#file);
    });
    this.#fileWrites = update.catch(() => undefined);
    return update;
  }
}
