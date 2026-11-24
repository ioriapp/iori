import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix } from "node:path";
import { MAX_WRITE_BYTES } from "@iori/protocol";
import { revisionFor } from "./files-reading.ts";
import { fileUploadTemporaries } from "./files-upload-temporaries.ts";
import type {
  FilesManageMethod,
  FilesManageParams,
  FilesManageResults,
  ProtocolErrorCode,
  RequestByMethod,
} from "@iori/protocol";
import { isWithin } from "./path-boundary.ts";
import { errorCode } from "./reading-failure.ts";
import { FilePutFailure } from "./files-writing.ts";

type ManageRequest = Extract<RequestByMethod, { method: FilesManageMethod }>;

function checkWithin(root: string, real: string) {
  if (!isWithin(root, real)) throw new FilePutFailure("path_outside_root");
  return real;
}

async function directory(path: string) {
  if (!(await stat(path)).isDirectory())
    throw new FilePutFailure("not_a_directory");
  return path;
}

async function targetPath(root: string, path: string, createParents = false) {
  const parts = path.split("/");
  if (
    process.platform === "win32" &&
    parts.some(
      (part) =>
        /[<>:"|?*\u0000-\u001f]|[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part),
    )
  )
    throw new FilePutFailure("invalid_request");
  if (
    path.includes("\\") ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    throw new FilePutFailure("invalid_request");
  const name = parts.pop()!;
  let parent = root;
  for (const part of parts) {
    const next = join(parent, part);
    if (createParents) {
      try {
        await mkdir(next);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
    parent = await directory(checkWithin(root, await realpath(next)));
  }
  return join(parent, name);
}

async function existingItem(target: string) {
  try {
    return await lstat(target, { bigint: true });
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return undefined;
  }
}

async function writableItem(
  root: string,
  target: string,
  { expectedRevision, force }: FilesManageParams["files.write"],
) {
  const existing = await existingItem(target);
  if (existing?.isSymbolicLink()) {
    const canonical = await realpath(target).catch(() => undefined);
    if (canonical) checkWithin(root, canonical);
    throw new FilePutFailure("put_not_a_file");
  }
  if (existing && !existing.isFile())
    throw new FilePutFailure("put_not_a_file");
  if (!force) {
    if (!existing) throw new FilePutFailure("path_not_found");
    if (
      expectedRevision !== undefined &&
      // eslint-disable-next-line iori/no-stored-value-rejection -- Compare live filesystem metadata before replacing an externally editable file.
      revisionFor(existing) !== expectedRevision
    )
      throw new FilePutFailure("file_conflict");
  }
  return existing;
}

async function saveText(
  root: string,
  params: FilesManageParams["files.write"],
) {
  const target = await targetPath(root, params.path);
  const bytes = Buffer.from(params.contentBase64, "base64");
  if (bytes.byteLength > MAX_WRITE_BYTES)
    throw new FilePutFailure("invalid_request");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FilePutFailure("invalid_request");
  }
  const existing = await writableItem(root, target, params);
  const temp = join(dirname(target), `.iori-save-${randomUUID()}`);
  fileUploadTemporaries.add(temp);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      try {
        await handle.writeFile(bytes);
        if (existing && process.platform !== "win32")
          await handle.chmod(Number(existing.mode & 0o777n));
        await handle.sync();
      } finally {
        await handle.close();
      }
      if ((await targetPath(root, params.path)) !== target)
        throw new FilePutFailure("file_conflict");
      await writableItem(root, target, params);
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  } finally {
    fileUploadTemporaries.delete(temp);
  }
  const info = await lstat(target, { bigint: true });
  return {
    revision: revisionFor(info),
    sizeBytes: Number(info.size),
    modifiedAtMs: Number(info.mtimeMs),
  };
}

async function renameItem(
  root: string,
  { from, to, root: selected }: FilesManageParams["files.rename"],
) {
  if (from === to) throw new FilePutFailure("invalid_request");
  const source = await targetPath(root, from);
  const info = await lstat(source, { bigint: true });
  if (info.isDirectory() && to.startsWith(from + "/"))
    throw new FilePutFailure("invalid_request");
  const dest = await targetPath(root, to);
  if (
    source === dest ||
    (info.isDirectory() && isWithin(source, dirname(dest)))
  )
    throw new FilePutFailure("invalid_request");
  const existing = await existingItem(dest);
  if (
    existing &&
    !(
      source.toLowerCase() === dest.toLowerCase() &&
      info.dev === existing.dev &&
      info.ino === existing.ino
    )
  )
    throw new FilePutFailure("put_exists");
  await rename(source, dest);
  return { path: to, absolutePath: join(selected, to) };
}

async function duplicateItem(
  root: string,
  { root: selected, path }: FilesManageParams["files.duplicate"],
) {
  const source = await targetPath(root, path);
  const info = await lstat(source);
  const kind = info.isSymbolicLink()
    ? "symlink"
    : info.isDirectory()
      ? "directory"
      : "file";
  if (kind === "file" && !info.isFile()) throw new FilePutFailure("put_failed");
  if (kind === "symlink") checkWithin(root, await realpath(source));
  const extension = kind === "file" ? extname(source) : "";
  const stem = basename(source, extension);
  for (let copy = 1; ; copy++) {
    const name = stem + " copy" + (copy === 1 ? "" : " " + copy) + extension;
    const dest = join(dirname(source), name);
    if (await existingItem(dest)) continue;
    try {
      if (kind === "directory")
        await cp(source, dest, {
          recursive: true,
          force: false,
          errorOnExist: true,
          verbatimSymlinks: true,
        });
      else if (kind === "symlink") await symlink(await readlink(source), dest);
      else await copyFile(source, dest, constants.COPYFILE_EXCL);
    } catch (error) {
      if (
        errorCode(error) === "EEXIST" ||
        errorCode(error) === "ERR_FS_CP_EEXIST"
      )
        continue;
      throw error;
    }
    const copyPath = posix.join(posix.dirname(path), name);
    return {
      path: copyPath,
      absolutePath: join(selected, copyPath),
      kind,
    } as const;
  }
}

async function manage(
  root: string,
  request: ManageRequest,
): Promise<FilesManageResults[FilesManageMethod]> {
  switch (request.method) {
    case "files.create": {
      const { path, kind, root: selected } = request.params;
      const target = await targetPath(root, path, true);
      if (kind === "directory") await mkdir(target);
      else await (await open(target, "wx", 0o666)).close();
      return { path, absolutePath: join(selected, path), kind };
    }
    case "files.write":
      return saveText(root, request.params);
    case "files.rename":
      return renameItem(root, request.params);
    case "files.duplicate":
      return duplicateItem(root, request.params);
    case "files.delete": {
      const target = await targetPath(root, request.params.path);
      if ((await lstat(target)).isDirectory())
        await rm(target, { recursive: true });
      else await unlink(target);
      return {};
    }
  }
}

// Serialize tree mutations within a root so a concurrent rename cannot overwrite its destination.
const pending = new Map<string, Promise<unknown>>();
const errors: Partial<Record<string, ProtocolErrorCode>> = {
  ENOENT: "path_not_found",
  ENOTDIR: "not_a_directory",
  EEXIST: "put_exists",
  EACCES: "permission_denied",
  EPERM: "permission_denied",
};

export async function handleFileManage(request: ManageRequest) {
  try {
    if (!isAbsolute(request.params.root))
      throw new FilePutFailure("path_outside_root");
    const root = await directory(await realpath(request.params.root));
    const previous = pending.get(root);
    const operation = (previous ?? Promise.resolve())
      .catch(() => {})
      .then(() => manage(root, request));
    pending.set(root, operation);
    try {
      return await operation;
    } finally {
      if (pending.get(root) === operation) pending.delete(root);
    }
  } catch (error) {
    if (error instanceof FilePutFailure) throw error;
    throw new FilePutFailure(errors[errorCode(error)] ?? "put_failed");
  }
}
