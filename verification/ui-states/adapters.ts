import { current, stateId } from "./runtime.ts";
import { host, version, terminalFontNames } from "./fixtures.ts";

const previewHost = stateId.startsWith("token-")
  ? {
      ...host,
      os: stateId.includes("-windows-")
        ? "Windows"
        : stateId.includes("-linux-")
          ? "Linux"
          : undefined,
    }
  : host;
const snapshot = {
  observedHosts: {},
  connectedHosts: ["B1", "B2-disconnected"].includes(stateId)
    ? []
    : [host.publicKey],
  initial: {
    mobile: stateId === "B8",
    hosts: [previewHost],
    canSetupHost: true,
  },
  host,
  devices: [],
  hosts: {},
  clis: {},
};
export const connection = {
  subscribe: () => () => {},
  subscribeHostEvents: () => () => {},
  requestHost: async () => ({ ok: true, result: { folders: [] } }),
  getSnapshot: () => snapshot,
  connectionIdOf: () => "ui-state",
};
// どのボタンを押してもnativeやHostへは接続しない。処理の遷移は扱わない。
export const native = { fontFamilies: async () => terminalFontNames };
export const hasWindowChrome = false;
export const clientVersion = version;
export const hostReleaseNotes = "";
export const hostNeedsUpdate = () => false;
export const useHostMaintenance = () => undefined;
export const prepareHostMaintenance = async () => current.flow?.phase;
export const performHostMaintenance = async () => undefined;
