import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostStore } from "../store.ts";
import { ForgeSites } from "./sites.ts";
import { TokenVault } from "./token-vault.ts";

const vault = (root: string, hostKey = `test-${randomUUID()}`) =>
  new TokenVault({
    hostKey,
    root,
    secureFile: () => Promise.reject(new Error("the token file was written")),
    protect: (data) => data,
    unprotect: (data) => data,
  });
const available = (await vault(tmpdir()).storage()) === "os";
const skip = !available && "このHostにはOSの資格情報の保管所が無い";
const site = () => `https://forgejo-${randomUUID()}.example.invalid`;
const token = () => randomBytes(20).toString("hex");

// The web E2E's machine has no OS credential store, so these paths only run
// on a Host that has one (Windows Credential Manager, Secret Service on Linux).
test(
  "OSの資格情報の保管所があるHostでは、tokenがデータフォルダーに書かれず保管所だけに置かれ、別のHostの登録と混ざらず、削除で残らない",
  { skip },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-token-vault-"));
    const origin = site();
    const value = token();
    const host = vault(root);
    try {
      assert.equal(await host.write(origin, value), "os");
      assert.equal(await host.read(origin, "os"), value);
      assert.deepEqual(await readdir(root), []);
      assert.equal(await vault(root).read(origin, "os"), undefined);
    } finally {
      await host.delete(origin, "os");
      await rm(root, { recursive: true, force: true });
    }
    assert.equal(await host.read(origin, "os"), undefined);
  },
);

test(
  "OSの資格情報の保管所があるHostで、登録したサイトのtokenを保管所から消すと全て消え、残るサイトが無い",
  { skip },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "iori-token-vault-"));
    const store = new HostStore(join(root, "host.sqlite"));
    const host = vault(root);
    const origins = [site(), site()];
    try {
      for (const origin of origins) {
        assert.equal(await host.write(origin, token()), "os");
        store.setForgeToken(origin, "os", "");
      }
      const sites = new ForgeSites(store, host, () => undefined);
      assert.deepEqual(await sites.removeStoredTokens(), {
        removed: 2,
        remaining: [],
      });
      for (const origin of origins)
        assert.equal(await host.read(origin, "os"), undefined);
    } finally {
      for (const origin of origins)
        await host.delete(origin, "os").catch(() => undefined);
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
