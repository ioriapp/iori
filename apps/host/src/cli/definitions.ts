import { constants, createReadStream, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  parse as parseJsonc,
  type ParseError as JsoncParseError,
} from "jsonc-parser";
import {
  MAX_FRAME_BYTES,
  type CliDefinitionFailure,
  type CliDefinitionReason,
  type CliSummary,
} from "@iori/protocol";
import { commitAtomicFile } from "../fs/atomic-write.ts";
import {
  attachedFiles,
  readDefinition,
  reasonText,
} from "./definition-file.ts";
import {
  hooksTarget,
  hooksLink,
  removeWrittenHooks,
  writtenPath,
} from "./definition-hooks.ts";
import {
  definitionImages,
  type DefinitionImage,
  definitionFilePath,
} from "./definition-images.ts";
import { ByteLimitError, readBoundedFileBytes } from "../resource-limits.ts";
import {
  cliDefinition,
  definitionInfo,
  type CliDefinition,
} from "./definition-builder.ts";
import {
  bundled,
  bundledCode,
  bundledDefinition,
  bundledIconHashes,
  isBundledDefinition,
} from "./bundled-definitions.ts";
export {
  bundledDefinition,
  isBundledDefinition,
  writesDefinitionHooks,
  listsModels,
} from "./bundled-definitions.ts";
export {
  cliSupport,
  definitionInfo,
  type DefinitionInfo,
  type DefinitionArguments,
  type TeamLaunch,
  type CliCode,
  type CliDefinition,
} from "./definition-builder.ts";
export const cliDefinitions: CliDefinition[] = [...bundled];
/** 1-based line and column for a UTF-16 code unit offset in `text`. */
export function lineColumnAt(
  text: string,
  offset: number,
): { line: number; column: number } {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < end; i++) {
    if (text[i] === "\r") {
      line += 1;
      column = 1;
      if (i + 1 < end && text[i + 1] === "\n") i += 1;
    } else if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/** Read a definition received as text, for the folder `id`. */
export function readDefinitionText(
  text: string,
  id: string,
): ReturnType<typeof readDefinition> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const errors: JsoncParseError[] = [];
    parseJsonc(text, errors, {
      disallowComments: true,
      allowTrailingComma: false,
    });
    if (errors.length > 0) {
      const { line, column } = lineColumnAt(text, errors[0].offset);
      return { reason: { kind: "json", line, column } };
    }
    return { reason: { kind: "json" } };
  }
  return readDefinition(value, id);
}

/** User definitions by folder, in the order they were added: the text last
 * read and what it gave. */
const users = new Map<
  string,
  {
    text?: string;
    reason?: CliDefinitionReason;
    definition?: CliDefinition;
    images?: Map<string, DefinitionImage>;
  }
>();
/** Whether the folder was read; one that cannot be read now keeps the
 * definitions read before, and the hooks written for them. */
async function readUserDefinitions(directory: string): Promise<boolean> {
  let folders: string[] = [];
  try {
    const entries = (await readdir(directory, { withFileTypes: true }))
      // A linked folder is read too (definitions kept with dotfiles).
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink());
    // The list shows user definitions in the order they were added.
    const added = await Promise.all(
      entries.map(async (entry) => ({
        name: entry.name,
        birth: await stat(join(directory, entry.name)).then(
          (info) => info.birthtimeMs,
          () => 0,
        ),
      })),
    );
    folders = added
      .sort(
        (a, b) =>
          a.birth - b.birth || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("iori-host cli-definitions-unreadable");
      return false;
    }
  }
  let changed =
    folders.length !== users.size ||
    folders.some((folder, index) => [...users.keys()][index] !== folder);
  const read = new Map<string, NonNullable<ReturnType<typeof users.get>>>();
  for (const folder of folders) {
    const previous = users.get(folder);
    let text: string;
    try {
      text = (
        await readBoundedFileBytes(
          join(directory, folder, "definition.json"),
          MAX_FRAME_BYTES,
        )
      ).toString("utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        previous &&
        code !== "ENOENT" &&
        code !== "ENOTDIR" &&
        !(error instanceof ByteLimitError)
      ) {
        read.set(folder, previous);
        continue;
      }
      text = "";
    }
    const result: ReturnType<typeof readDefinition> = text
      ? readDefinitionText(text, folder)
      : { reason: { kind: "unreadable" } };
    if ("reason" in result) {
      changed = true;
      // The Host's log keeps why this CLI is missing; others still load.
      console.error(
        `iori-host cli-definition-skipped: ${folder}: ${reasonText(result.reason)}`,
      );
      read.set(folder, { text, reason: result.reason });
      continue;
    }
    const folderPath = join(directory, folder);
    const image = await definitionImages(result.definition, folderPath);
    if ("reason" in image) {
      changed = true;
      read.set(folder, { text, reason: image.reason });
      continue;
    }
    if (
      previous?.text === text &&
      previous.definition &&
      JSON.stringify([...(previous.images?.keys() ?? [])]) ===
        JSON.stringify([...image.images.keys()])
    ) {
      read.set(folder, { ...previous, images: image.images });
      continue;
    }
    changed = true;
    const definition = cliDefinition(
      result.definition,
      text,
      isBundledDefinition(folder) ? "override" : "user",
      folderPath,
      bundledCode(folder),
    );
    const builtin = bundledDefinition(folder);
    if (builtin && result.definition.launch.interrupt === undefined)
      definition.interrupt = builtin.interrupt;
    const original = bundledIconHashes.get(folder);
    const sameBundledIcon =
      !!original &&
      !!image.icon &&
      original.light === image.icon.light &&
      original.dark === image.icon.dark;
    definition.icon = sameBundledIcon ? builtin!.icon : image.icon;
    definition.customIcon = !!result.definition.icon && !sameBundledIcon;
    read.set(folder, { text, definition, images: image.images });
  }
  if (!changed && [...users.keys()].every((folder) => read.has(folder)))
    return true;
  users.clear();
  for (const [folder, entry] of read) users.set(folder, entry);
  const definitions = [...users.values()].flatMap(
    (entry) => entry.definition ?? [],
  );
  cliDefinitions.splice(
    0,
    cliDefinitions.length,
    ...bundled.map(
      (definition) =>
        definitions.find((user) => user.id === definition.id) ?? definition,
    ),
    ...definitions.filter(
      (user) => !bundled.some((definition) => definition.id === user.id),
    ),
  );
  return true;
}
/** The user's definitions that are not read, in the order they were added. */
export function failedDefinitions(): CliDefinitionFailure[] {
  return [...users].flatMap(([folder, entry]) =>
    entry.reason
      ? [{ folder, reason: entry.reason, definition: entry.text ?? "" }]
      : [],
  );
}
/** Folders of the user's definitions, read or not. */
export const userDefinitionFolders = () => [...users.keys()];

let loading = Promise.resolve();
/** Write the user's definition of `id` and read the definitions again. */
export async function saveUserDefinition(
  root: string,
  id: string,
  text: string,
  files: ({ name: string } & ({ source: string } | { bytes: Buffer }))[] = [],
  retainedFiles?: string[],
): Promise<void> {
  const folder = join(root, "cli-definitions", id);
  await mkdir(folder, { recursive: true });
  const pending = new Map<
    string,
    { source: string } | { data: string | Buffer }
  >();
  const source = bundledDefinition(id);
  const info = source && definitionInfo(source);
  if (info) {
    for (const name of attachedFiles(info.file)) {
      const destination = await definitionFilePath(folder, name, true);
      try {
        await lstat(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try {
          const source = join(info.folder, name);
          if ((await stat(source)).isFile())
            pending.set(destination, { source });
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code !== "ENOENT")
            throw readError;
        }
      }
    }
  }
  for (const file of files)
    pending.set(
      await definitionFilePath(folder, file.name, true),
      "source" in file ? { source: file.source } : { data: file.bytes },
    );
  pending.set(join(folder, "definition.json"), { data: text });

  const staged: {
    destination: string;
    next: string;
    backup?: string;
    published: boolean;
  }[] = [];
  let preserveBackups = false;
  try {
    for (const [destination, content] of pending) {
      const next = join(dirname(destination), `.iori-${randomUUID()}.tmp`);
      const entry: (typeof staged)[number] = {
        destination,
        next,
        published: false,
      };
      try {
        if ("source" in content)
          await pipeline(
            createReadStream(content.source),
            createWriteStream(next, { mode: 0o600, flags: "wx" }),
          );
        else await writeFile(next, content.data, { mode: 0o600, flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
          await rm(next, { force: true }).catch(() => {});
        throw error;
      }
      staged.push(entry);
      let previous;
      try {
        previous = await lstat(destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (previous) {
        const backup = join(dirname(destination), `.iori-${randomUUID()}.tmp`);
        try {
          if (previous.isSymbolicLink())
            await symlink(await readlink(destination), backup, "file");
          else await copyFile(destination, backup, constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST")
            await rm(backup, { force: true }).catch(() => {});
          throw error;
        }
        entry.backup = backup;
      }
    }
    try {
      for (const entry of staged) {
        await commitAtomicFile(entry.next, entry.destination);
        entry.published = true;
      }
    } catch (error) {
      for (const entry of [...staged].reverse()) {
        if (!entry.published) continue;
        try {
          if (entry.backup) {
            await commitAtomicFile(entry.backup, entry.destination);
            entry.backup = undefined;
          } else await rm(entry.destination, { force: true });
        } catch {
          preserveBackups = true;
        }
      }
      throw error;
    }
    if (retainedFiles) {
      const keep = new Set(
        [
          "definition.json",
          ...retainedFiles,
          ...files.map((file) => file.name),
          ...staged.flatMap((entry) =>
            [entry.next, ...(entry.backup ? [entry.backup] : [])].map((path) =>
              relative(folder, path),
            ),
          ),
        ].map((name) => name.replaceAll("\\", "/")),
      );
      const prune = async (directory: string, prefix = "") => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const name = prefix + entry.name;
          if (keep.has(name)) continue;
          if (
            entry.isDirectory() &&
            [...keep].some((file) => file.startsWith(name + "/"))
          )
            await prune(join(directory, entry.name), name + "/");
          else
            await rm(join(directory, entry.name), {
              recursive: true,
              force: true,
            });
        }
      };
      await prune(folder);
    }
  } finally {
    await Promise.all(
      staged.flatMap((entry) => [
        rm(entry.next, { force: true }).catch(() => {}),
        ...(!preserveBackups && entry.backup
          ? [rm(entry.backup, { force: true }).catch(() => {})]
          : []),
      ]),
    );
  }
  await loadCliDefinitions(root);
}
/** Delete the user's definition of `id` with the files that came with it.
 * Reading the definitions again removes the hooks recorded for it. */
export async function removeUserDefinition(
  root: string,
  id: string,
): Promise<void> {
  await rm(join(root, "cli-definitions", id), { recursive: true, force: true });
  await loadCliDefinitions(root);
}
/** Read the user's definitions in `<root>/cli-definitions/<id>/`. A user's
 * definition replaces the bundled one with the same `id`. Hooks that this
 * Host recorded for a definition that is gone, or now writes elsewhere, are
 * removed. */
export function loadCliDefinitions(root: string): Promise<void> {
  const next = loading.then(async () => {
    if (!(await readUserDefinitions(join(root, "cli-definitions")))) return;
    const home = homedir();
    await removeWrittenHooks(writtenPath(root), (id, written) => {
      if (written.copy?.formal) return false;
      const definition = cliDefinitions.find((entry) => entry.id === id);
      const hooks = definition && definitionInfo(definition)?.writtenHooks;
      return (
        !hooks ||
        hooksTarget(hooks, home, id) !== written.file ||
        JSON.stringify(
          hooks.format === "plugin-file" ? undefined : hooks.own,
        ) !== JSON.stringify(written.own) ||
        JSON.stringify(hooksLink(hooks, home)) !==
          JSON.stringify(
            written.link && {
              file: written.link.file,
              base: written.link.base,
              set: written.link.set,
            },
          )
      );
    }).catch(() => {
      console.error("iori-host cli-definition-hooks-not-removed");
    });
  });
  loading = next.catch(() => {});
  return next;
}

/** Branding follows the installed Host, including conversations saved earlier. */
export function withCurrentCliIcon(cli: CliSummary): CliSummary {
  return {
    ...cli,
    icon: cliDefinitions.find((definition) => definition.id === cli.id)?.icon,
  };
}

/** A hash names the exact bytes from a currently loaded user definition. */
export function cliDefinitionImage(hash: string): DefinitionImage | undefined {
  for (const entry of users.values()) {
    const image = entry.images?.get(hash);
    if (image) return image;
  }
  return undefined;
}
