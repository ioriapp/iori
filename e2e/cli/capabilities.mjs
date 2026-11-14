// Capabilities selected by the monitoring request, never by the CLI's current behavior.
export const capabilities = {
  claude: { fakeModel: true, approval: true },
  codex: { fakeModel: true, approval: true },
  pi: { fakeModel: true, approval: false },
  opencode: { fakeModel: true, approval: true },
  omp: { fakeModel: true, approval: true },
  cursor: { fakeModel: false, catalog: "ログインが要るので確かめない" },
  antigravity: { fakeModel: false, catalog: "ログインが要るので確かめない" },
  "muse-code": { fakeModel: false, catalog: "ログインが要るので確かめない" },
};
