import type { FileHandle } from "node:fs/promises";

/** Read only top-level credential strings. The argv/body, including nested or
 * escaped strings, is traversed without retaining it. JSON.parse still checks
 * the complete envelope after authentication, before any command executes. */
export async function commandCredentials(
  file: FileHandle,
): Promise<{ session?: string; auth?: string }> {
  const credentials: { session?: string; auth?: string } = {};
  const chunk = Buffer.alloc(64 * 1024);
  const { size } = await file.stat();
  let position = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let token: string | undefined;
  let key: string | undefined;
  let expectingKey = true;
  let started = false;
  let ended = false;
  while (position < size) {
    const { bytesRead } = await file.read(
      chunk,
      0,
      Math.min(chunk.length, size - position),
      position,
    );
    if (bytesRead === 0) break;
    position += bytesRead;
    // Credentials and JSON punctuation are ASCII; non-ASCII bytes occur only
    // in ignored content or in strings JSON.parse will reject as credentials.
    for (const byte of chunk.subarray(0, bytesRead)) {
      const character = String.fromCharCode(byte);
      if (quoted) {
        if (token !== undefined) {
          token += character;
          // Even fully escaped UUID/session and auth strings fit this bound.
          if (token.length > 512) token = undefined;
        }
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') {
          quoted = false;
          if (depth === 1) {
            let value: unknown;
            try {
              value = token === undefined ? undefined : JSON.parse(token);
            } catch {
              return {};
            }
            if (expectingKey)
              key = typeof value === "string" ? value : undefined;
            else if (key === "auth" || key === "session")
              credentials[key] = typeof value === "string" ? value : undefined;
          }
        }
        continue;
      }
      if (/\s/u.test(character)) continue;
      if (ended) return {};
      if (!started) {
        if (character !== "{") return {};
        started = true;
        depth = 1;
        continue;
      }
      if (character === '"') {
        quoted = true;
        token = depth === 1 ? '"' : undefined;
      } else if (character === "{" || character === "[") {
        if (depth === 1 && (key === "auth" || key === "session"))
          credentials[key] = undefined;
        depth += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) ended = true;
      } else if (depth === 1) {
        if (character === ":") expectingKey = false;
        else if (character === ",") {
          expectingKey = true;
          key = undefined;
        } else if (key === "auth" || key === "session") {
          credentials[key] = undefined;
        }
      }
    }
  }
  return ended && !quoted ? credentials : {};
}
