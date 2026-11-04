import { commitAtomicFile } from "./fs/atomic-write.ts";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { NativeAddon, NativeIdentity } from "./native.ts";

export interface HostStorage {
  root: string;
  databasePath: string;
  keyPath: string;
  localConfigPath: string;
  identity: NativeIdentity;
  persistLocalConfig(port: number, token: string): Promise<void>;
  removeLocalConfig(): Promise<void>;
  secureFile(path: string): Promise<void>;
}

export function storageRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) throw new Error("LOCALAPPDATA is not available");
    return join(localAppData, "iori-host");
  }

  const dataHome = process.env.XDG_DATA_HOME;
  if (dataHome) {
    if (!isAbsolute(dataHome)) {
      throw new Error("XDG_DATA_HOME must be an absolute path");
    }
    return join(dataHome, "iori-host");
  }
  return join(homedir(), ".local", "share", "iori-host");
}

export function hostControlPath(): string {
  return join(storageRoot(), "control.json");
}

async function verifyRegularFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("Host storage file is not a regular file");
  }
}

async function securePath(path: string, native: NativeAddon): Promise<void> {
  if (process.platform === "win32") native.restrictToCurrentUser(path);
  else await chmod(path, 0o600);
}

async function createKeyFile(
  path: string,
  identity: NativeIdentity,
  native: NativeAddon,
): Promise<void> {
  const secret =
    process.platform === "win32"
      ? native.protectUserData(identity.secretKey)
      : identity.secretKey;
  const file = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await file.writeFile(secret);
    await file.sync();
  } finally {
    await file.close();
  }
  if (process.platform === "win32") native.restrictToCurrentUser(path);
  else await chmod(path, 0o600);
}

async function loadKeyFile(path: string, native: NativeAddon): Promise<Buffer> {
  await verifyRegularFile(path);
  if (process.platform === "win32") native.restrictToCurrentUser(path);
  else await chmod(path, 0o600);

  const saved = await readFile(path);
  let secret: Buffer;
  try {
    secret =
      process.platform === "win32" ? native.unprotectUserData(saved) : saved;
  } catch {
    throw new Error("Host key could not be read by this Windows user");
  }
  if (secret.byteLength !== 32) {
    throw new Error("Host key file has an invalid length");
  }
  return secret;
}

export async function openHostStorage(
  native: NativeAddon,
): Promise<HostStorage> {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Host storage path is not a directory");
  }
  if (process.platform === "win32") native.restrictToCurrentUser(root);
  else await chmod(root, 0o700);

  const keyPath = join(root, "host-key");
  let identity: NativeIdentity;
  try {
    const key = await loadKeyFile(keyPath, native);
    identity = native.identityFromSecretKey(key);
    key.fill(0);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      const generated = native.generateIdentity();
      try {
        await createKeyFile(keyPath, generated, native);
        identity = generated;
      } catch (createError) {
        generated.secretKey.fill(0);
        if (
          typeof createError === "object" &&
          createError !== null &&
          "code" in createError &&
          createError.code === "EEXIST"
        ) {
          const key = await loadKeyFile(keyPath, native);
          identity = native.identityFromSecretKey(key);
          key.fill(0);
        } else {
          throw createError;
        }
      }
    } else {
      throw error;
    }
  }

  const databasePath = join(root, "host.sqlite");
  const localConfigPath = join(root, "control.json");
  return {
    root,
    databasePath,
    keyPath,
    localConfigPath,
    identity,
    async persistLocalConfig(port, token) {
      const tempPath = join(root, `control.${randomUUID()}.tmp`);
      try {
        const file = await open(
          tempPath,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
          0o600,
        );
        try {
          await file.writeFile(JSON.stringify({ port, token }));
          await file.sync();
        } finally {
          await file.close();
        }
        await securePath(tempPath, native);
        await commitAtomicFile(tempPath, localConfigPath);
        await securePath(localConfigPath, native);
      } catch (error) {
        await rm(tempPath, { force: true });
        throw error;
      }
    },
    async removeLocalConfig() {
      await rm(localConfigPath, { force: true });
    },
    async secureFile(path) {
      await securePath(path, native);
    },
  };
}
