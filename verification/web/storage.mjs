import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hostname } from "node:os";
import { loadNativeAddon } from "../../apps/host/src/native.ts";

// This is a development identity, NOT DPAPI/Keystore protected product storage.
export async function openStorage(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("bridgeの保存先は通常のdirectoryを指定してください");
  await chmod(root, 0o700);
  const addon = loadNativeAddon();
  const keyPath = join(root, "device-key");
  let key;
  try {
    const info = await lstat(keyPath);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("bridgeの鍵が通常のfileではありません");
    await chmod(keyPath, 0o600);
    key = await readFile(keyPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    key = addon.generateIdentity().secretKey;
    await writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
  }
  // identityFromSecretKey rejects a damaged key; never regenerate it silently.
  const identity = addon.identityFromSecretKey(key);
  key.fill(0);
  const databasePath = join(root, "client.sqlite");
  const db = new DatabaseSync(databasePath);
  await chmod(databasePath, 0o600);
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (key TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS views (scope TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  const load = (scope) => {
    const row = db.prepare("SELECT json FROM views WHERE scope = ?").get(scope);
    return row ? JSON.parse(row.json) : null;
  };
  const save = (scope, value) => {
    db.prepare(
      "INSERT INTO views VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET json=excluded.json",
    ).run(scope, JSON.stringify(value));
  };
  return {
    identity,
    initial({ language, mobile }) {
      return {
        publicKey: identity.publicKeyHex,
        deviceName: `Chromium (${hostname()})`,
        language,
        mobile,
        canScanQr: false,
        hosts: db
          .prepare("SELECT json FROM hosts ORDER BY rowid")
          .all()
          .map((row) => JSON.parse(row.json)),
        activeHostKey: load("active-host"),
      };
    },
    saveHost(host, select) {
      db.exec("BEGIN");
      try {
        db.prepare(
          "INSERT INTO hosts VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json=excluded.json",
        ).run(host.publicKey, JSON.stringify(host));
        if (select) save("active-host", host.publicKey);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    load,
    save,
    close() {
      db.close();
      identity.secretKey.fill(0);
    },
  };
}
