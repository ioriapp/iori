import { adb } from "./remote.mjs";
import { waitFor } from "../ui.mjs";

// Settings may show a list even when opened with the package URI. Identify
// the app's own row before touching a switch; never fall back to the first one.
export async function setAndroidInstallPermission(appLabel, allowed) {
  const settings = ["com.android.settings"];
  const readControl = () =>
    permissionControl(androidSystemControls(settings), appLabel);
  let controls = await waitFor(() => {
    const current = androidSystemControls(settings);
    return permissionControl(current, appLabel) ||
      current.some((node) => node.scrollable === "true")
      ? current
      : undefined;
  });
  let permission = permissionControl(controls, appLabel);
  let seekingStart = true;
  while (!permission) {
    if (
      controls.some(
        (node) =>
          node["resource-id"] === "android:id/title" && node.text === appLabel,
      )
    )
      throw new Error("対象アプリのスイッチを特定できません");
    const list = controls.find((node) => node.scrollable === "true");
    const bounds = list?.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u);
    if (!bounds) throw new Error("アプリ一覧の位置がありません");
    const [left, top, right, bottom] = bounds.slice(1).map(Number);
    const x = String(Math.round((left + right) / 2));
    adb([
      "shell",
      "input",
      "swipe",
      x,
      String(Math.round(top + (bottom - top) * (seekingStart ? 0.2 : 0.8))),
      x,
      String(Math.round(top + (bottom - top) * (seekingStart ? 0.8 : 0.2))),
      "300",
    ]);
    const next = androidSystemControls(settings);
    if (JSON.stringify(next) === JSON.stringify(controls)) {
      if (!seekingStart) throw new Error("アプリ一覧に対象アプリがありません");
      seekingStart = false;
    }
    controls = next;
    permission = permissionControl(controls, appLabel);
  }
  if (permission.checked !== String(allowed))
    tapAndroidSystemControl(permission);
  await waitFor(readControl, (control) => control?.checked === String(allowed));
  const confirmation = androidSystemControls(settings).find(
    (node) =>
      node.enabled === "true" && node["resource-id"] === "android:id/button1",
  );
  if (confirmation) tapAndroidSystemControl(confirmation);
  return confirmation?.text ?? null;
}

function permissionControl(controls, appLabel) {
  const titles = controls.filter(
    (node) =>
      node["resource-id"] === "android:id/title" && node.text === appLabel,
  );
  if (titles.length !== 1) return undefined;
  for (const ancestor of titles[0].ancestors.toReversed()) {
    // A missing/disabled switch must not make us climb into another app's row.
    const rowTitles = controls.filter(
      (node) =>
        node.ancestors.includes(ancestor) &&
        node["resource-id"] === "android:id/title",
    );
    if (rowTitles.length > 1) return undefined;
    const switches = controls.filter(
      (node) =>
        node.enabled === "true" &&
        node.ancestors.includes(ancestor) &&
        /Switch/u.test(node.class),
    );
    if (switches.length === 1) return switches[0];
    if (switches.length > 1) return undefined;
  }
  return undefined;
}

// Select only the foreground OS dialog's controls. Do not retain the hierarchy
// (which can contain unrelated system UI text) in evidence.
export async function androidSystemControl(packages, predicate) {
  return await waitFor(() =>
    androidSystemControls(packages).find(
      (node) => node.enabled === "true" && predicate(node),
    ),
  );
}

export function androidActivityResumed(packages) {
  const activities = adb(["shell", "dumpsys", "activity", "activities"]);
  return activities
    .split(/\r?\n/u)
    .some(
      (line) =>
        /mResumedActivity|topResumedActivity/u.test(line) &&
        packages.some((name) => line.includes(name + "/")),
    );
}

// Client return needs only the resumed Activity, not the WebView's full tree.
export async function waitForAndroidForeground(packageName) {
  await waitFor(() => androidActivityResumed([packageName]));
}

// A release WebView has no CDP. A failed accessibility dump is an unavailable
// observation; the caller's existing observation window owns retries/deadline.
export function androidClientTextVisible(packageName, texts) {
  return readAndroidControls([packageName], { tolerateDumpFailure: true }).some(
    (node) => texts.includes(node.text),
  );
}

const androidInstallerPackages = [
  "com.google.android.packageinstaller",
  "com.android.packageinstaller",
];

export function androidInstallerControls() {
  return androidSystemControls(androidInstallerPackages);
}

export async function androidInstallerControl(predicate) {
  return await androidSystemControl(androidInstallerPackages, predicate);
}

export function androidSystemControls(packages) {
  return readAndroidControls(packages);
}

function readAndroidControls(packages, { tolerateDumpFailure = false } = {}) {
  if (!androidActivityResumed(packages)) return [];
  const dump = `/data/local/tmp/iori-system-ui-${process.pid}.xml`;
  let hierarchy;
  try {
    try {
      adb(["shell", "uiautomator", "dump", dump]);
    } catch (error) {
      if (!tolerateDumpFailure) throw error;
      return [];
    }
    hierarchy = adb(["exec-out", "cat", dump]);
  } finally {
    adb(["shell", "rm", "-f", dump]);
  }
  const controls = [];
  const ancestors = [];
  let nodeId = 0;
  for (const match of hierarchy.matchAll(/<\/?node\b[^>]*>/gu)) {
    if (match[0].startsWith("</")) {
      ancestors.pop();
      continue;
    }
    const attributes = Object.fromEntries(
      [...match[0].matchAll(/([\w-]+)="([^"]*)"/gu)].map((attribute) => [
        attribute[1],
        attribute[2],
      ]),
    );
    attributes.nodeId = nodeId;
    attributes.ancestors = [...ancestors];
    if (!match[0].endsWith("/>")) ancestors.push(nodeId);
    nodeId += 1;
    if (packages.includes(attributes.package)) controls.push(attributes);
  }
  return controls;
}

export function tapAndroidSystemControl(control) {
  const bounds = control.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u);
  if (!bounds) throw new Error("Androidの操作対象の位置がありません");
  const [left, top, right, bottom] = bounds.slice(1).map(Number);
  adb([
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2)),
  ]);
}
