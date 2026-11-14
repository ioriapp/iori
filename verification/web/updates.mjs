import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import semver from "semver";
const version = JSON.parse(
  await readFile(
    new URL("../../release-version.json", import.meta.url),
    "utf8",
  ),
).version;

// The browser bridge substitutes only the OS boundary. Update discovery uses
// a real HTTP response; the product's controller and settings are unchanged.
export function updateCommands(source, { download = false } = {}) {
  const restart = source?.endsWith("/restart");
  let runningVersion = restart ? "0.0.1" : version;
  return {
    native_update_options: async () => {
      if (!source) return null;
      if (restart) {
        const response = await fetch(source + "/running");
        runningVersion = (await response.json()).version;
      }
      return {
        version: runningVersion,
        backgroundDownload: false,
        foregroundOnly: false,
      };
    },
    ...(download
      ? {
          native_update_download: async () => {
            try {
              const response = await fetch(source + "/asset");
              await response.arrayBuffer();
            } catch {
              throw new Error("download");
            }
          },
          native_update_install: async () => {
            throw new Error("install");
          },
        }
      : {}),
    ...(restart
      ? {
          native_update_download: () => {},
          native_update_install: async () => {
            const response = await fetch(source + "/install", {
              method: "POST",
            });
            const release = await response.json();
            runningVersion = release.version;
            return "installing";
          },
        }
      : {}),
    native_update_check: async ({ development }) => {
      let path = "/latest/download/updater.json";
      if (development) {
        const list = await fetch(source + "/api/releases");
        if (!list.ok) throw new Error(`HTTP ${list.status}`);
        const releases = await list.json();
        const newest = releases
          .filter((release) => !release.draft)
          .map((release) => release.tag_name.slice(1))
          .sort(semver.rcompare)[0];
        if (!newest) return null;
        path = `/download/v${newest}/updater.json`;
      }
      const response = await fetch(source + path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = await response.json();
      return semver.gt(release.version, runningVersion)
        ? { version: release.version, notesUrl: source + "/notes" }
        : null;
    },
  };
}
export async function updateDistribution({ clientRestart = false } = {}) {
  let installs = 0;
  let available = false;
  let checks = 0;
  const nextVersion = clientRestart ? version : semver.inc(version, "patch");
  const developmentVersion = `${semver.inc(nextVersion, "patch")}-beta.1`;
  let stableVersion = nextVersion;
  const server = createServer((request, response) => {
    // The simulated OS version belongs to this installation, not to the
    // WebSocket session that is replaced when the Client opens again.
    if (request.url === "/restart/running") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ version: installs ? nextVersion : "0.0.1" }),
      );
      return;
    }
    if (request.url === "/restart/install" && request.method === "POST")
      installs++;
    else checks++;
    response.writeHead(available ? 200 : 503, {
      "Content-Type": "application/json",
    });
    if (request.url?.endsWith("/api/releases")) {
      response.end(
        JSON.stringify([
          { tag_name: `v${stableVersion}`, draft: false, prerelease: false },
          {
            tag_name: `v${developmentVersion}`,
            draft: false,
            prerelease: true,
          },
        ]),
      );
    } else {
      response.end(
        JSON.stringify({
          version: request.url?.includes(`/v${developmentVersion}/`)
            ? developmentVersion
            : stableVersion,
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    source: `http://127.0.0.1:${server.address().port}${clientRestart ? "/restart" : ""}`,
    get installs() {
      return installs;
    },
    nextVersion,
    developmentVersion,
    makeStableOlder: () => {
      stableVersion = "0.0.0";
    },
    restoreStable: () => {
      stableVersion = nextVersion;
    },
    get checks() {
      return checks;
    },
    publish: () => {
      available = true;
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
