import { preparePublicationBody } from "../publish/snapshot.mjs";
import { githubRequest, repository } from "./github.mjs";

const [version, ...options] = process.argv.slice(2);
if (!version) throw new Error("version is required");
const body = await preparePublicationBody(version, options);
const tag = `v${version}`;

if (options.includes("--dry-run")) {
  console.log(
    `GET ${repository}/releases/tags/${encodeURIComponent(tag)}\nPATCH ${repository}/releases/<release-id>\n${JSON.stringify({ body })}`,
  );
} else {
  const release = await githubRequest(
    `/releases/tags/${encodeURIComponent(tag)}`,
  );
  if (!release) throw new Error("Release not found");
  await githubRequest(`/releases/${release.id}`, "PATCH", { body });
}
