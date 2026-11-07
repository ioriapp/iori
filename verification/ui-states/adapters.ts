import { current, stateId } from "./runtime.ts";
import { host, version } from "./fixtures.ts";

const snapshot = {
  connectedHosts: ["B1", "B2-disconnected"].includes(stateId)
    ? []
    : [host.publicKey],
  initial: { mobile: stateId === "B8", hosts: [host], canSetupHost: true },
  host,
  devices: [],
  hosts: {},
  clis: {},
};
export const connection = {
  subscribe: () => () => {},
  getSnapshot: () => snapshot,
  connectionIdOf: () => "ui-state",
};
// どのボタンを押してもnativeやHostへは接続しない。処理の遷移は扱わない。
export const native = {};
export const hasWindowChrome = false;
export const clientVersion = version;
export const hostReleaseNotes = "";
export const hostNeedsUpdate = () => false;
export const useHostMaintenance = () => undefined;
export const prepareHostMaintenance = async () => current.flow?.phase;
export const performHostMaintenance = async () => undefined;
