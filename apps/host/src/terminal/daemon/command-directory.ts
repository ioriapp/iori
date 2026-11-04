import { mkdir, copyFile, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "../../fs/atomic-write.ts";

/** Only this Host's cold-start daemon reclaims its recorded command copies. */
export class CommandDirectories {
  readonly #file: string;
  readonly #root: string;
  readonly #directories = new Set<string>();
  #serial: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.#root = root;
    this.#file = join(root, "team-command-sessions.json");
  }

  async initialize(): Promise<void> {
    try {
      const saved: string[] = JSON.parse(await readFile(this.#file, "utf8"));
      for (const directory of saved) this.#directories.add(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Keep the damaged record for diagnosis; it must not stop the daemon.
        await rename(this.#file, `${this.#file}.corrupt-${randomUUID()}`).catch(
          () => {},
        );
        console.warn("Could not read the team command directory record.");
      }
    }
    for (const directory of this.#directories) {
      try {
        await rm(directory, { recursive: true, force: true });
        if (process.platform !== "win32")
          await rm(this.deliveryDirectory(directory), {
            recursive: true,
            force: true,
          });
        this.#directories.delete(directory);
      } catch {
        // A still-open executable on Windows is reclaimed at the next start.
      }
    }
    await this.#record(() => {});
  }

  #record(change: () => void): Promise<void> {
    const saved = this.#serial.then(async () => {
      change();
      await writeFileAtomic(
        this.#file,
        JSON.stringify([...this.#directories]) + "\n",
      );
    });
    this.#serial = saved.catch(() => {});
    return saved.catch(() => {
      console.warn("Could not save the team command directory record.");
    });
  }

  deliveryDirectory(directory: string): string {
    return process.platform === "win32"
      ? directory
      : join(this.#root, "team-deliveries", basename(directory));
  }

  async create(directory: string): Promise<void> {
    try {
      // Record before copying so an interrupted creation can be reclaimed.
      await this.#record(() => this.#directories.add(directory));
      if (process.platform !== "win32") {
        await mkdir(this.deliveryDirectory(directory), {
          recursive: true,
          mode: 0o700,
        });
        return;
      }
      const name = "iori.exe";
      const target = join(directory, name);
      await copyFile(
        fileURLToPath(
          new URL(name, import.meta.resolve("@iori/terminal-native")),
        ),
        target,
      );
    } catch (error) {
      await this.remove(directory);
      throw error;
    }
  }

  async remove(directory: string): Promise<void> {
    if (process.platform !== "win32")
      await rm(this.deliveryDirectory(directory), {
        recursive: true,
        force: true,
      });
    await rm(directory, { recursive: true, force: true });
    await this.#record(() => this.#directories.delete(directory));
  }
}
