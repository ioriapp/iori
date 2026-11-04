import { adb } from "./remote.mjs";
import { waitFor } from "../ui.mjs";
import {
  androidSystemControl,
  androidSystemControls,
  tapAndroidSystemControl,
  androidActivityResumed,
} from "./android-system-ui.mjs";

// Use the launcher's actual icon so singleTask follows the same task stack
// behavior as returning from Home by hand, rather than am start MainActivity.
async function openAndroidLauncherApps() {
  const resolved = adb([
    "shell",
    "cmd",
    "package",
    "resolve-activity",
    "--brief",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.HOME",
  ]);
  const launcher = resolved.trim().split(/\r?\n/u).at(-1).split("/")[0];
  if (!androidActivityResumed([launcher]))
    adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
  // Nova can remain in its drawer/search after uninstall. Pressing Home on
  // its workspace opens search on this device, so do not press it blindly.
  const surface = await androidSystemControl([launcher], (node) =>
    ["workspace", "apps_list_view", "app_search_results"].some(
      (id) => node["resource-id"] === launcher + ":id/" + id,
    ),
  );
  if (surface["resource-id"] === launcher + ":id/apps_list_view")
    return launcher;
  if (surface["resource-id"] === launcher + ":id/app_search_results")
    adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  const workspace =
    surface["resource-id"] === launcher + ":id/workspace"
      ? surface
      : await androidSystemControl(
          [launcher],
          (node) => node["resource-id"] === launcher + ":id/workspace",
        );
  swipeUp(workspace);
  return launcher;
}

export async function openAndroidLauncherApp(appLabel) {
  const launcher = await openAndroidLauncherApps();
  const pages = new Set();
  for (;;) {
    const controls = await waitFor(
      () => androidSystemControls([launcher]),
      (nodes) =>
        nodes.some(
          (node) => node["resource-id"] === launcher + ":id/apps_list_view",
        ),
    );
    const list = controls.find(
      (node) => node["resource-id"] === launcher + ":id/apps_list_view",
    );
    const icons = controls.filter(
      (node) =>
        node.enabled === "true" &&
        node.ancestors.includes(list.nodeId) &&
        node.bounds !== "[0,0][0,0]" &&
        (node.text === appLabel || node["content-desc"] === appLabel),
    );
    if (icons.length === 1) {
      tapAndroidSystemControl(icons[0]);
      return;
    }
    if (icons.length > 1)
      throw new Error("検証アプリのランチャーアイコンを一意に特定できません");
    const signature = JSON.stringify(
      controls.map((node) => [node.text, node["content-desc"], node.bounds]),
    );
    if (pages.has(signature))
      throw new Error("ランチャーに検証アプリのアイコンが見つかりません");
    pages.add(signature);
    swipeUp(list);
  }
}

function swipeUp(control) {
  const bounds = control.bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/u);
  if (!bounds) throw new Error("ランチャーの操作対象の位置がありません");
  const [left, top, right, bottom] = bounds.slice(1).map(Number);
  const x = Math.round((left + right) / 2);
  adb([
    "shell",
    "input",
    "swipe",
    String(x),
    String(Math.round(top + (bottom - top) * 0.8)),
    String(x),
    String(Math.round(top + (bottom - top) * 0.2)),
    "300",
  ]);
}
