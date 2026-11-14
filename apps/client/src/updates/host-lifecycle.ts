import type { MaintenanceStatus } from "@iori/protocol";
import { native } from "../native.ts";
export type HostRemoval = {
  status?: MaintenanceStatus;
  local: boolean;
  sshDestination?: string;
  hostName?: string;
  os?: string;
  sshLostNoticeDismissed?: boolean;
};
let records: Record<string, HostRemoval> = {};
let saving = Promise.resolve();
export async function loadHostRemovals() {
  records =
    (await native.loadView<Record<string, HostRemoval>>("host-removals")) ?? {};
  return records;
}
export function hostRemoval(key: string) {
  return records[key];
}
export function saveHostRemoval(key: string, value?: HostRemoval) {
  records = { ...records };
  if (value) records[key] = value;
  else delete records[key];
  const next = records;
  saving = saving
    .catch(() => {})
    .then(() => native.saveView("host-removals", next));
  return saving;
}
export function hostReconnectPaused(key: string) {
  const value = records[key];
  return (
    value?.status?.phase === "removing" || value?.status?.phase === "succeeded"
  );
}
