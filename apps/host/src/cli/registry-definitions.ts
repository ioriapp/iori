import { attachedFiles, attached } from "./definition-file.ts";
import { constants } from "node:fs";
import { access, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DefinitionUploads,
  definitionFilePath,
  inspectDefinitionImage,
  readDefinitionIcon,
  DefinitionAttachmentError,
} from "./definition-images.ts";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import type {
  CliDefinitionResults,
  CliDefinitionAttachment,
  CliDefinitionReason,
  CliSimpleDefinition,
  CliDefinitionFile,
  Response,
} from "@iori/protocol";
import { ByteLimitError, readBoundedFileBytes } from "../resource-limits.ts";
import type { HostStore, StoreContext } from "../store.ts";
import type { ShellDefinition } from "../terminal/platform.ts";
import {
  cliDefinitions,
  bundledDefinition,
  cliDefinitionImage,
  definitionInfo,
  isBundledDefinition,
  loadCliDefinitions,
  readDefinitionText,
  removeUserDefinition,
  saveUserDefinition,
  userDefinitionFolders,
  writesDefinitionHooks,
} from "./definitions.ts";
import {
  definitionEffects,
  idFromName,
  simpleDefinition,
  simpleFields,
} from "./user-definitions.ts";

/** A user's definition in `cli-definitions/` that this Host reads. */
const isUserDefinition = (id: string) => {
  const definition = cliDefinitions.find((entry) => entry.id === id);
  const source = definition && definitionInfo(definition)?.source;
  return source === "user" || source === "override";
};

export function definitionFiles(
  file: import("./definition-file.ts").DefinitionFile,
): CliDefinitionFile[] {
  return [
    ...(file.usage && "script" in file.usage
      ? [{ name: file.usage.script, kind: "usage" as const }]
      : []),
    ...(file.tokens && "script" in file.tokens
      ? [{ name: file.tokens.script, kind: "tokens" as const }]
      : []),
    ...(file.hooks?.format === "plugin-file"
      ? [{ name: file.hooks.install.copy, kind: "plugin" as const }]
      : []),
  ];
}

export class CliDefinitionEditor {
  protected readonly store: HostStore;
  protected readonly definitionsRoot?: string;
  readonly #uploads?: DefinitionUploads;
  /** Definitions are checked and written one change at a time. */
  #definitionChanges: Promise<unknown> = Promise.resolve();
  constructor(store: HostStore, definitionsRoot?: string) {
    this.store = store;
    this.definitionsRoot = definitionsRoot;
    if (definitionsRoot) this.#uploads = new DefinitionUploads(definitionsRoot);
  }
  async close(): Promise<void> {
    await this.#uploads?.close();
  }
  /** Check a definition received as JSON and say what saving it does
   * (cli-definitions.md「確認」). `id` is the definition being edited. */
  async checkDefinition(
    text: string,
    shell: ShellDefinition,
    id?: string,
    files?: CliDefinitionAttachment[],
    owner = "",
  ): Promise<Response<CliDefinitionResults["cli.definition.check"]>> {
    if (this.definitionsRoot) await loadCliDefinitions(this.definitionsRoot);
    const read = readDefinitionText(text, id ?? this.#ownId(text));
    if ("reason" in read) return { ok: true, result: { reason: read.reason } };
    const { definition } = read;
    const prepared = await this.#prepareFiles(definition, files, owner);
    if ("reason" in prepared || "missing" in prepared)
      return { ok: true, result: prepared };
    const folder = join(
      this.definitionsRoot!,
      "cli-definitions",
      definition.id,
    );
    const added = new Set(prepared.files.map((entry) => entry.name));
    const builtin = bundledDefinition(definition.id);
    const info = builtin && definitionInfo(builtin);
    for (const name of attachedFiles(definition)) {
      if (added.has(name)) continue;
      for (const source of [folder, ...(info ? [info.folder] : [])]) {
        try {
          if ((await stat(await definitionFilePath(source, name))).isFile()) {
            added.add(name);
            break;
          }
        } catch (error) {
          if (error instanceof DefinitionAttachmentError) break;
          if (
            !["ENOENT", "ENOTDIR"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
        }
      }
    }
    const effects = definitionEffects(
      definition,
      shell,
      homedir(),
      writesDefinitionHooks(definition),
      [...added],
    );
    const previous = cliDefinitions.find((entry) => entry.id === definition.id);
    const previousInfo = previous && definitionInfo(previous);
    const withoutIcon = (value: Record<string, unknown>) => {
      const { icon: _icon, ...rest } = value;
      return rest;
    };
    const iconOnly =
      previousInfo &&
      prepared.files.every(
        (entry) =>
          entry.name === definition.icon?.light ||
          entry.name === definition.icon?.dark,
      ) &&
      isDeepStrictEqual(
        withoutIcon(JSON.parse(previousInfo.text)),
        withoutIcon(JSON.parse(text)),
      );
    return {
      ok: true,
      result: {
        summary: {
          id: definition.id,
          name: definition.name,
          replaces:
            userDefinitionFolders().includes(definition.id) ||
            isBundledDefinition(definition.id),
          overrides: isBundledDefinition(definition.id),
          ...effects,
          requiresConfirmation:
            ((!id || !userDefinitionFolders().includes(id)) &&
              (userDefinitionFolders().includes(definition.id) ||
                isBundledDefinition(definition.id))) ||
            (!iconOnly &&
              !!(
                effects.commands.length ||
                effects.settings.length ||
                effects.files.length
              )),
        },
      },
    };
  }
  /** The `id` that a definition added as JSON gives its folder. */
  #ownId(text: string): string {
    try {
      const value: unknown = JSON.parse(text);
      const id =
        value && typeof value === "object"
          ? (value as Record<string, unknown>).id
          : undefined;
      return typeof id === "string" ? id : "";
    } catch {
      return "";
    }
  }
  /** `change` returns undefined for a request that names no definition. */
  #definitionChange<T>(
    context: StoreContext,
    change: () => Promise<T | undefined>,
  ): Promise<Response<T>> {
    const next = this.#definitionChanges.then(
      async (): Promise<Response<T>> => {
        const previous = this.store.terminalOperationResult<T>(context);
        if (previous) return { ok: true, result: previous };
        if (!this.definitionsRoot)
          return { ok: false, error: { code: "internal_error" } };
        await loadCliDefinitions(this.definitionsRoot);
        const result = await change();
        if (result === undefined)
          return { ok: false, error: { code: "invalid_request" } };
        this.store.saveTerminalOperationResult(context, result);
        return { ok: true, result };
      },
    );
    this.#definitionChanges = next.catch(() => {});
    return next.catch(() => ({
      ok: false,
      error: { code: "internal_error" },
    }));
  }
  /** Save a definition received as JSON in `cli-definitions/<id>/`. */
  saveDefinition(
    context: StoreContext,
    text: string,
    id?: string,
    files?: CliDefinitionAttachment[],
  ): Promise<Response<CliDefinitionResults["cli.definition.save"]>> {
    return this.#definitionChange(context, async () => {
      const read = readDefinitionText(text, id ?? this.#ownId(text));
      if ("reason" in read) return { reason: read.reason };
      const prepared = await this.#prepareFiles(
        read.definition,
        files ?? [],
        context.clientPublicKey,
      );
      if ("reason" in prepared || "missing" in prepared) return prepared;
      await saveUserDefinition(
        this.definitionsRoot!,
        read.definition.id,
        text,
        prepared.files,
        !id &&
          (userDefinitionFolders().includes(read.definition.id) ||
            isBundledDefinition(read.definition.id))
          ? attachedFiles(read.definition)
          : undefined,
      );
      await this.#uploads?.discard(
        context.clientPublicKey,
        files?.map((file) => file.uploadId) ?? [],
      );
      return { cliId: read.definition.id };
    });
  }
  /** Validate files at the external input boundary, before publishing JSON. */
  async #prepareFiles(
    file: import("./definition-file.ts").DefinitionFile,
    uploads: CliDefinitionAttachment[] | undefined,
    owner: string,
  ): Promise<
    | { files: { name: string; source: string }[] }
    | { reason: CliDefinitionReason }
    | { missing: string[] }
  > {
    // Without uploads this is a preview for the editor's missing-file notice.
    // Every save supplies an attachment list, including an empty one.
    if (!uploads) return { files: [] };
    const files: { name: string; source: string }[] = [];
    const missing: string[] = [];
    const builtin = bundledDefinition(file.id);
    const bundledInfo = builtin && definitionInfo(builtin);
    for (const name of new Set([
      ...attachedFiles(file),
      ...uploads.map((entry) => entry.name),
    ])) {
      try {
        attached(name, "file");
      } catch {
        return { reason: { kind: "inside", field: "file" } };
      }
      const field =
        file.icon?.light === name
          ? "icon.light"
          : file.icon?.dark === name
            ? "icon.dark"
            : "file";
      let source: string | undefined;
      const upload = uploads.find((entry) => entry.name === name);
      try {
        if (upload && this.#uploads) {
          source = this.#uploads.path(owner, upload.uploadId);
          if (!(await stat(source)).isFile())
            throw new Error("Expected a regular file");
        } else {
          const folders = [
            join(this.definitionsRoot!, "cli-definitions", file.id),
            ...(bundledInfo ? [bundledInfo.folder] : []),
          ];
          for (const folder of folders) {
            try {
              source = await definitionFilePath(folder, name);
              if (!(await stat(source)).isFile())
                throw new Error("Expected a regular file");
              break;
            } catch (error) {
              source = undefined;
              if (
                (error as NodeJS.ErrnoException).code !== "ENOENT" &&
                (error as NodeJS.ErrnoException).code !== "ENOTDIR"
              )
                throw error;
            }
          }
        }
        if (
          source &&
          field.startsWith("icon.") &&
          !(await inspectDefinitionImage(name, source))
        )
          return { reason: { kind: "values", field, values: ["SVG", "PNG"] } };
        if (source && field === "file") await access(source, constants.R_OK);
      } catch (error) {
        if (error instanceof DefinitionAttachmentError)
          return { reason: { kind: "inside", field } };
        if (field.startsWith("icon."))
          return { reason: { kind: "values", field, values: ["SVG", "PNG"] } };
        throw error;
      }
      if (!source) {
        missing.push(name);
        continue;
      }
      if (upload) files.push({ name, source });
    }
    return missing.length ? { missing } : { files };
  }
  async writeDefinitionFile(
    owner: string,
    params: import("@iori/protocol").CliDefinitionParams["cli.definition.file.write"],
  ) {
    return this.#uploads!.write(
      owner,
      params.uploadId,
      params.data,
      params.first,
    );
  }
  async readDefinitionFile(
    id: string,
    name: string,
  ): Promise<Response<CliDefinitionResults["cli.definition.file.read"]>> {
    if (this.definitionsRoot) await loadCliDefinitions(this.definitionsRoot);
    const definition = cliDefinitions.find((entry) => entry.id === id);
    const info = definition && definitionInfo(definition);
    if (
      !info ||
      (info.source === "user" && simpleFields(info.file, info.text)) ||
      !definitionFiles(info.file).some((file) => file.name === name)
    )
      return { ok: false, error: { code: "invalid_request" } };
    try {
      const bytes = await readBoundedFileBytes(
        await definitionFilePath(info.folder, name),
        1_048_576,
      );
      if (bytes.includes(0)) return { ok: true, result: { unsupported: true } };
      try {
        return {
          ok: true,
          result: {
            text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          },
        };
      } catch {
        return { ok: true, result: { unsupported: true } };
      }
    } catch (error) {
      if (error instanceof ByteLimitError)
        return { ok: true, result: { unsupported: true } };
      return { ok: false, error: { code: "internal_error" } };
    }
  }
  discardDefinitionFiles(owner: string, ids: string[]) {
    return this.#uploads!.discard(owner, ids);
  }
  readIcon(hash: string, offset: number) {
    const image = cliDefinitionImage(hash);
    if (!image) throw new Error("Image not found");
    return readDefinitionIcon(image, offset);
  }
  setIcon(
    context: StoreContext,
    params: import("@iori/protocol").CliDefinitionParams["cli.icon.set"],
  ): Promise<Response<CliDefinitionResults["cli.icon.set"]>> {
    return this.#definitionChange(context, async () => {
      const current = cliDefinitions.find((entry) => entry.id === params.cliId);
      const info = current && definitionInfo(current);
      if (!info) return undefined;
      const value = JSON.parse(info.text);
      const files: { name: string; source: string }[] = [];
      if (params.image) {
        const source = this.#uploads!.path(
          context.clientPublicKey,
          params.image.uploadId,
        );
        let image: Awaited<ReturnType<typeof inspectDefinitionImage>>;
        try {
          image = await inspectDefinitionImage(params.image.name, source);
        } catch {
          return { invalidImage: true as const };
        }
        if (!image) return { invalidImage: true as const };
        const name = `icon-${image.hash}.${image.mimeType === "image/png" ? "png" : "svg"}`;
        value.icon = { light: name };
        files.push({ name, source });
      } else {
        const builtin = bundledDefinition(params.cliId);
        if (builtin?.icon) value.icon = builtin.icon;
        else delete value.icon;
      }
      await saveUserDefinition(
        this.definitionsRoot!,
        params.cliId,
        JSON.stringify(value, null, 2) + "\n",
        files,
      );
      const retained = new Set(
        attachedFiles({ ...info.file, icon: value.icon }),
      );
      for (const old of [info.file.icon?.light, info.file.icon?.dark]) {
        if (
          old &&
          /^icon-[a-f0-9]{64}\.(?:svg|png)$/u.test(old) &&
          !retained.has(old)
        )
          await rm(
            join(this.definitionsRoot!, "cli-definitions", params.cliId, old),
            { force: true },
          );
      }
      if (params.image)
        await this.#uploads!.discard(context.clientPublicKey, [
          params.image.uploadId,
        ]);
      return { cliId: params.cliId };
    });
  }
  /** Save the minimal definition of the name and command fields. */
  saveSimple(
    context: StoreContext,
    simple: CliSimpleDefinition,
    id?: string,
  ): Promise<Response<CliDefinitionResults["cli.definition.simple"]>> {
    return this.#definitionChange(context, async () => {
      // An edit names a user's definition; its folder stays in place.
      if (id && !isUserDefinition(id)) return undefined;
      const cliId = id ?? idFromName(simple.name);
      if (
        !id &&
        (userDefinitionFolders().includes(cliId) || isBundledDefinition(cliId))
      ) {
        return {
          replacement:
            JSON.stringify(simpleDefinition(simple, cliId), null, 2) + "\n",
        };
      }
      const current = id
        ? cliDefinitions.find((definition) => definition.id === id)
        : undefined;
      // Items written by hand in the user's file are kept.
      const text = current && definitionInfo(current)?.text;
      const previous = text
        ? (JSON.parse(text) as Record<string, unknown>)
        : undefined;
      await saveUserDefinition(
        this.definitionsRoot!,
        cliId,
        JSON.stringify(simpleDefinition(simple, cliId, previous), null, 2) +
          "\n",
      );
      return { cliId };
    });
  }
  /** Delete a user's definition: a bundled one with the same `id` is used
   * again. Open Terminals of the CLI keep running. */
  removeDefinition(
    context: StoreContext,
    id: string,
  ): Promise<Response<CliDefinitionResults["cli.definition.remove"]>> {
    return this.#definitionChange(context, async () => {
      // Only a folder of `cli-definitions/` is deleted; one already gone
      // stays deleted.
      if (userDefinitionFolders().includes(id))
        await removeUserDefinition(this.definitionsRoot!, id);
      if (this.store.lastUsedCli() === id && !isBundledDefinition(id))
        this.store.forgetLastUsedCli();
      return { cliId: id };
    });
  }
}
