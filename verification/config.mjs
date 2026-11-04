import { readFileSync } from "node:fs";
import path from "node:path";

export const configPath =
  process.env.IORI_VERIFICATION_CONFIG ??
  "verification/connection/tauri.conf.json";
export const verificationConfig = JSON.parse(
  readFileSync(path.resolve(configPath), "utf8"),
);
export const verificationIdentifier = verificationConfig.identifier;
export const verificationAndroidPackage =
  verificationIdentifier +
  (process.env.IORI_VERIFICATION_ANDROID_PROFILE === "release"
    ? ""
    : verificationConfig.bundle.android.debugApplicationIdSuffix);
