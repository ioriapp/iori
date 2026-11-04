import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const file =
  process.env.IORI_VERIFICATION_LOCAL ??
  path.join(os.homedir(), ".config/iori/verification.json");
let value;
function readLocal(item) {
  if (value) return value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} の ${item} を読めません: ${error.message}`);
  }
  return value;
}
export const local = new Proxy(
  {},
  {
    get: (_, section) =>
      new Proxy(
        {},
        {
          get: (_, key) => {
            const item = `${String(section)}.${String(key)}`;
            const result = readLocal(item)[section]?.[key];
            if (typeof result !== "string" || !result)
              throw new Error(`${file} の ${item} を設定してください`);
            return result;
          },
        },
      ),
  },
);
