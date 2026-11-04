import addon from "@iori/host-iroh-native";
import terminalNative from "@iori/terminal-native";

export type NativeIdentity = import("@iori/host-iroh-native").Identity;
export type NativeEndpoint = import("@iori/host-iroh-native").Endpoint;
export type NativeIncoming = import("@iori/host-iroh-native").Incoming;
export type NativeConnection = import("@iori/host-iroh-native").Connection;
export type NativeBiStream = import("@iori/host-iroh-native").BiStream;

export type NativeAddon = Pick<
  typeof import("@iori/host-iroh-native"),
  | "Endpoint"
  | "generateIdentity"
  | "identityFromSecretKey"
  | "protectUserData"
  | "unprotectUserData"
> &
  typeof terminalNative;

export function loadNativeAddon(): NativeAddon {
  return { ...addon, ...terminalNative };
}
