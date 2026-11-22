import type { ForgeMapping, ResultByMethod } from "@iori/protocol";
import {
  type Connection,
  type Mutation,
  type StoreContext,
  succeeded,
} from "./connection.ts";

export function createForgeRepository({
  database,
  transaction,
  saveOperation,
  replayOperation,
}: Connection) {
  function forgeMapping(remoteHost: string): ForgeMapping | undefined {
    const row = database
      .prepare("SELECT web_url FROM forge_mappings WHERE remote_host = ?")
      .get(remoteHost) as { web_url: string } | undefined;
    return row ? { remoteHost, webUrl: row.web_url } : undefined;
  }
  function setForgeMapping(
    context: StoreContext,
    mapping: ForgeMapping,
  ): Mutation<ResultByMethod["forge.mapping.set"]> {
    const previous =
      replayOperation<ResultByMethod["forge.mapping.set"]>(context);
    if (previous) return { response: previous };
    return transaction(() => {
      database
        .prepare(
          "INSERT INTO forge_mappings (remote_host, web_url) VALUES (?, ?) ON CONFLICT(remote_host) DO UPDATE SET web_url = excluded.web_url",
        )
        .run(mapping.remoteHost, mapping.webUrl);
      const response = succeeded({ mapping });
      saveOperation(context, response);
      return { response, changed: true };
    });
  }
  function removeForgeMapping(
    context: StoreContext,
    remoteHost: string,
  ): Mutation<ResultByMethod["forge.mapping.remove"]> {
    const previous =
      replayOperation<ResultByMethod["forge.mapping.remove"]>(context);
    if (previous) return { response: previous };
    return transaction(() => {
      database
        .prepare("DELETE FROM forge_mappings WHERE remote_host = ?")
        .run(remoteHost);
      const response = succeeded({ remoteHost });
      saveOperation(context, response);
      return { response, changed: true };
    });
  }

  /** Where each site's token is kept; the token itself is never in SQLite. */
  function forgeTokens(): {
    origin: string;
    storage: "os" | "file";
    account: string;
  }[] {
    return database
      .prepare("SELECT origin, storage, account FROM forge_tokens")
      .all() as { origin: string; storage: "os" | "file"; account: string }[];
  }
  function forgeToken(
    origin: string,
  ): { storage: "os" | "file"; account: string } | undefined {
    return database
      .prepare("SELECT storage, account FROM forge_tokens WHERE origin = ?")
      .get(origin) as { storage: "os" | "file"; account: string } | undefined;
  }
  function setForgeToken(
    origin: string,
    storage: "os" | "file",
    account: string,
  ) {
    database
      .prepare(
        "INSERT INTO forge_tokens (origin, storage, account) VALUES (?, ?, ?) ON CONFLICT(origin) DO UPDATE SET storage = excluded.storage, account = excluded.account",
      )
      .run(origin, storage, account);
  }
  function removeForgeToken(origin: string) {
    database.prepare("DELETE FROM forge_tokens WHERE origin = ?").run(origin);
  }
  return {
    forgeMapping,
    setForgeMapping,
    removeForgeMapping,
    forgeTokens,
    forgeToken,
    setForgeToken,
    removeForgeToken,
  };
}
