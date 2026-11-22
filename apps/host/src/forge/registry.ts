import { readGitHubStatus, githubCheckUrl } from "./github.ts";
import { readGitHubCi, readGitHubCiLog } from "./github-ci.ts";
import { githubIssues } from "./github-issues.ts";
import { githubPullRequests } from "./github-pull-requests.ts";
import {
  detectForgejo,
  readForgejoStatus,
  forgejoCheckUrl,
} from "./forgejo.ts";
import { readForgejoCi, readForgejoCiLog } from "./forgejo-ci.ts";
import { forgejoIssues } from "./forgejo-issues.ts";
import { forgejoPullRequests } from "./forgejo-pull-requests.ts";
import type { ForgeAdapter } from "./types.ts";

/** Detection order and capabilities of the Host's built-in Forge providers. */
export const forgeProviders: readonly ForgeAdapter[] = [
  {
    id: "github",
    label: "GitHub",
    async detect(origin) {
      return origin === "https://github.com";
    },
    status: readGitHubStatus,
    checkUrl: githubCheckUrl,
    ci: { read: readGitHubCi, log: readGitHubCiLog },
    issues: githubIssues,
    pullRequests: githubPullRequests,
  },
  {
    id: "forgejo",
    label: "Forgejo",
    detect: detectForgejo,
    status: readForgejoStatus,
    checkUrl: forgejoCheckUrl,
    ci: {
      read: (target, _repository, signal) => readForgejoCi(target, signal),
      log: (target, job, before, _repository, signal) =>
        readForgejoCiLog(target, job, before, signal),
    },
    issues: forgejoIssues,
    pullRequests: forgejoPullRequests,
  },
];
