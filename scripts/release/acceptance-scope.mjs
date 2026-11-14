const boundaryPaths = [
  /^scripts\/release\/(?:install[^/]*|update[^/]*|uninstall[^/]*|updater\.mjs|service\.mjs|move-bundle\.mjs|stop(?:-windows)?\.mjs|launcher\.cs)$/u,
  /^apps\/client\/src\/updates\//u,
  /^apps\/client\/src\/connection\.ts$/u,
  /^apps\/client\/src-tauri\/src\/(?:updates|host_setup)\//u,
  /^apps\/client\/src-tauri\/src\/native\//u,
  /^apps\/client\/src-tauri\/plugins\/apk-installer\//u,
  /^apps\/host\/src\/(?:native|authorization)\.ts$/u,
  /^apps\/host\/src\/maintenance\//u,
  /^apps\/host\/native\//u,
  /^crates\/iori-iroh-config\//u,
];

export const scopedScenarios = [
  "terminal-daemon",
  "client-host-update",
  "host-uninstall",
  "terminal-retention",
];

export function acceptanceScope(files, daemonChanged) {
  const reasons = [];
  if (daemonChanged) reasons.push("Terminal デーモンの互換の指紋が変更");
  for (const file of files)
    if (boundaryPaths.some((pattern) => pattern.test(file)))
      reasons.push(`配布物の境界が変更: ${file}`);
  return reasons.length ? { type: "full", reasons } : { type: "scoped" };
}
