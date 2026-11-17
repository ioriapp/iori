import type { AttentionItem } from "../../apps/client/src/attention.ts";
import { MobileHome } from "../../apps/client/src/MobileHome.tsx";
import { SidebarProvider } from "../../apps/client/src/components/ui/sidebar.tsx";
import { translator } from "../../apps/client/src/i18n.ts";
import "../../apps/client/src/mobile-workspace.css";

const host = {
  publicKey: "approval-preview",
  hostName: "（仮）dev",
  addresses: [],
};
const longCommand = [
  "npm test -- \\",
  "  --runInBand \\",
  "  --coverage \\",
  "  --verbose \\",
  "  --detectOpenHandles \\",
  "  --testPathPattern=src \\",
  "  --coverageDirectory=coverage \\",
  "  --ci",
].join("\n");
export function ApprovalPreview({
  state,
  language,
}: {
  state: string;
  language: string;
}) {
  const scene = Number(state.split("-")[1]);
  const entries = [
    {
      id: "claude-1",
      cli: "claude",
      name: "Claude Code",
      tool: "Bash",
      command:
        scene === 2
          ? longCommand
          : scene === 10
            ? "npm run build"
            : "npm test -- --runInBand",
      icon: "claude.svg",
    },
    {
      id: "claude-2",
      cli: "claude",
      name: "Claude Code",
      tool: "Write",
      command: "src/App.tsx",
      icon: "claude.svg",
    },
    {
      id: "open",
      cli: "opencode",
      name: "OpenCode",
      tool: "Bash",
      command: "npm test -- --runInBand",
      icon: "opencode-light.svg",
      dark: "opencode-dark.svg",
    },
    {
      id: "codex",
      cli: "codex",
      name: "Codex",
      tool: "Bash",
      command: "npm test -- --runInBand",
      icon: "openai-black.svg",
      dark: "openai-white.svg",
    },
  ];
  const multiple = [3, 4, 5, 6, 7, 10, 11, 12].includes(scene);
  const shown =
    scene === 9
      ? []
      : [5, 7, 11].includes(scene)
        ? entries.slice(1)
        : multiple
          ? entries
          : entries.slice(0, 1);
  const attention: AttentionItem[] = shown.map((entry) => ({
    host,
    terminal: {
      id: entry.id,
      createdAt: 0,
      shell: "bash",
      cwd: "/preview/main",
      title: multiple && entry.cli === "claude" ? "（仮）Worker" : entry.name,
      cli: {
        id: entry.cli,
        name: entry.name,
        icon: { light: entry.icon, dark: entry.dark },
      },
      cols: 80,
      rows: 24,
      lastDesktopSize: { cols: 80, rows: 24 },
      cliStatus: {
        state: "waiting",
        since: 0,
        attention: {
          kind: scene === 8 ? "question" : "approval",
          tool: scene === 8 ? undefined : entry.tool,
          summary:
            scene === 8
              ? "（仮）どちらのテストランナーを使いますか？"
              : entry.command,
          ...(scene !== 8 && entry.cli !== "codex"
            ? {
                approval: {
                  id: scene === 10 ? "next-approval" : entry.id,
                  canRespond: true as const,
                  tool: entry.tool,
                  ...(entry.tool === "Write"
                    ? { paths: [entry.command] }
                    : { command: entry.command }),
                },
              }
            : {}),
        },
      },
    },
  }));
  return (
    <SidebarProvider>
      <MobileHome
        t={translator(language)}
        worktrees={[]}
        connectedHosts={scene === 6 ? [] : [host.publicKey]}
        summaries={{ [host.publicKey]: [] }}
        terminalLists={{}}
        attention={attention}
        running={[]}
        onBoard={() => {}}
        onOpen={() => {}}
        onAttention={() => {}}
        onSettings={() => {}}
      />
    </SidebarProvider>
  );
}
