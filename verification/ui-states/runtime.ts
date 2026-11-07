import { fixture } from "./fixtures.ts";

export const stateId =
  new URLSearchParams(location.search).get("state") ?? "A0";
export const current = fixture(stateId);
export function initialValue<T>(module: string, name: string, fallback: T): T {
  const values = current.initial[module];
  return values && Object.hasOwn(values, name) ? (values[name] as T) : fallback;
}
// HostSetupDialog / SshSetup の取得・接続・完了監視は静止画に不要。
// FlowDialog / Progress 等の寸法測定とスクロールのeffectは製品のまま動かす。
export function staticEffect() {}
