import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { ioriCommand } from "../host/environment.mjs";
import { hook } from "../host/send-hook.mjs";

const run = promisify(execFile);
const cli =
  process.env.IORI_README_CLI ||
  (basename(process.argv[1] || "").includes("codex") ? "codex" : "claude");

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(cli === "codex" ? "codex-cli 0.162.0" : "2.1.317 (Claude Code)");
  process.exit(0);
}

if (process.argv.includes("--help")) {
  console.log(`${cli} fake cli for README screenshots`);
  process.exit(0);
}

if (process.argv.includes("app-server")) {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    try {
      const msg = JSON.parse(line);
      if (typeof msg.id === "number") {
        const result = msg.method === "hooks/list" ? { data: [] } : {};
        process.stdout.write(JSON.stringify({ id: msg.id, result }) + "\n");
      }
    } catch {
      // ignore non-json
    }
  }
  process.exit(0);
}

const ackDir = process.env.IORI_README_ACK_DIR;
const sessionDir = process.env.IORI_README_SESSION_DIR;
const theme = process.env.IORI_README_THEME === "light" ? "light" : "dark";

if (process.stdin.isTTY) process.stdin.setRawMode(true);

const sessionId = randomUUID();
const transcriptPath = sessionDir
  ? join(sessionDir, `${cli}-${sessionId}.jsonl`)
  : undefined;

if (transcriptPath) {
  await mkdir(sessionDir, { recursive: true });
  await writeFile(transcriptPath, "");
}

const basePayload = {
  session_id: sessionId,
  cwd: process.cwd(),
  source: "startup",
  ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
};

const palette =
  theme === "light"
    ? {
        reset: "\x1b[0m",
        bold: "\x1b[1m",
        dim: "\x1b[38;2;107;114;128m",
        text: "\x1b[38;2;24;24;27m",
        accent: "\x1b[38;2;194;65;12m",
        blue: "\x1b[38;2;29;78;216m",
        green: "\x1b[38;2;21;128;61m",
        rule: "\x1b[38;2;203;213;225m",
        promptBg: "\x1b[48;2;241;245;249m\x1b[38;2;15;23;42m",
        mascot: "\x1b[38;2;194;65;12m",
      }
    : {
        reset: "\x1b[0m",
        bold: "\x1b[1m",
        dim: "\x1b[38;2;148;163;184m",
        text: "\x1b[38;2;241;245;249m",
        accent: "\x1b[38;2;217;119;87m",
        blue: "\x1b[38;2;125;177;255m",
        green: "\x1b[38;2;134;239;172m",
        rule: "\x1b[38;2;71;85;105m",
        promptBg: "\x1b[48;2;45;49;57m\x1b[38;2;241;245;249m",
        mascot: "\x1b[38;2;217;119;87m",
      };

function renderHero() {
  const c = palette;
  const cols = Math.max(36, (process.stdout.columns || 64) - 2);
  const hr = `${c.rule}${"─".repeat(cols)}${c.reset}`;
  const promptText = " › Read tasks/login-fix.md and follow its instructions.";
  const promptLine = `${c.promptBg}${promptText}${" ".repeat(Math.max(1, cols - promptText.length))}${c.reset}`;
  const effort = "◐ medium · /effort";
  const lines = [
    "",
    ` ${c.mascot} ▐▛███▜▌${c.reset}   ${c.bold}${c.text}Claude Code${c.reset} ${c.dim}v2.1.317${c.reset}`,
    ` ${c.mascot}▝▜█████▛▘${c.reset}  ${c.dim}Sonnet 5.5 · API Usage Billing${c.reset}`,
    ` ${c.mascot}  ▘▘ ▝▝${c.reset}    ${c.dim}~/projects/acme-web${c.reset}`,
    "",
    promptLine,
    "",
    `${c.dim}●${c.reset} ${c.bold}${c.text}Reading 2 files…${c.reset} ${c.dim}(ctrl+o to expand)${c.reset}`,
    `  ${c.dim}└ src/LoginForm.tsx${c.reset}`,
    "",
    `${c.accent}✳ Thinking…${c.reset} ${c.dim}(4s · ↓ 123 tokens)${c.reset}`,
    "",
    hr,
    `${c.text}› █${c.reset}`,
    hr,
    `  ${c.dim}manual mode on · esc to interrupt · ← for agents${c.reset}`,
    `${" ".repeat(Math.max(2, cols - effort.length))}${c.dim}${effort}${c.reset}`,
  ];
  process.stdout.write("\x1b[?25l\x1b[2J\x1b[H" + lines.join("\r\n") + "\r\n");
}

function renderApproval() {
  const c = palette;
  const cols = Math.max(34, (process.stdout.columns || 42) - 2);
  const hr = `${c.rule}${"─".repeat(cols)}${c.reset}`;
  const p1 = " › Read tasks/regression-tests.md and";
  const p2 = "   follow its instructions.";
  const prompt1 = `${c.promptBg}${p1}${" ".repeat(Math.max(1, cols - p1.length))}${c.reset}`;
  const prompt2 = `${c.promptBg}${p2}${" ".repeat(Math.max(1, cols - p2.length))}${c.reset}`;
  const lines = [
    `${c.dim}✳ Crunched for 1s · done 09:31 AM${c.reset}`,
    "",
    prompt1,
    prompt2,
    "",
    `${c.dim}Read 1 file (ctrl+o to expand)${c.reset}`,
    "",
    `${c.dim}●${c.reset} ${c.bold}${c.text}Bash${c.reset}${c.dim}(npm run test -- LoginForm)${c.reset}`,
    `  ${c.dim}└ Waiting…${c.reset}`,
    "",
    hr,
    `${c.bold}${c.blue}Bash command${c.reset}`,
    `${c.dim}Check the login form regression tests${c.reset}`,
    hr,
    `${c.text}npm run test -- LoginForm${c.reset}`,
    hr,
    `${c.text}This command requires approval${c.reset}`,
    "",
    `${c.text}Do you want to proceed?${c.reset}`,
    `${c.blue}❯ 1. Yes${c.reset}`,
    `  ${c.text}2. Yes, and don't ask again for: npm run *${c.reset}`,
    `  ${c.text}3. No${c.reset}`,
    "",
    `${c.dim}Esc to cancel · Tab to amend${c.reset}`,
  ];
  process.stdout.write("\x1b[?25l\x1b[2J\x1b[H" + lines.join("\r\n") + "\r\n");
}

function renderWorker() {
  const c = palette;
  const lines = [
    `${c.bold}${c.text}Codex${c.reset} ${c.dim}gpt-6-luna · low${c.reset}`,
    `${c.dim}Fix the login form: reset isSubmitting in finally.${c.reset}`,
    "",
    `${c.green}✓${c.reset} ${c.text}Updated src/LoginForm.tsx (+2 -1)${c.reset}`,
  ];
  process.stdout.write("\x1b[2J\x1b[H" + lines.join("\r\n") + "\r\n");
}

async function appendTokens(tokens) {
  if (!transcriptPath) return;
  if (cli === "codex") {
    const line = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            cached_input_tokens: tokens.cacheRead ?? 0,
            reasoning_output_tokens: tokens.reasoning ?? 0,
          },
        },
      },
    });
    await appendFile(transcriptPath, `${line}\n`);
    return;
  }
  const line = JSON.stringify({
    type: "assistant",
    message: {
      id: `msg_${randomUUID()}`,
      usage: {
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_read_input_tokens: tokens.cacheRead ?? 0,
        cache_creation_input_tokens: tokens.cacheWrite ?? 0,
        output_tokens_details: {
          thinking_tokens: tokens.reasoning ?? 0,
        },
      },
    },
  });
  await appendFile(transcriptPath, `${line}\n`);
}

async function ack(id, data = { ok: true }) {
  if (!ackDir || !id) return;
  await mkdir(ackDir, { recursive: true });
  await writeFile(join(ackDir, `${id}.json`), JSON.stringify(data));
}

process.on("SIGHUP", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.stdout.write("\x1b[?2004h");
await hook("SessionStart", basePayload);

const input = createInterface({ input: process.stdin, terminal: false });
for await (let line of input) {
  const start = line.indexOf('{"id":');
  if (start === -1) continue;
  line = line.slice(start);
  let step;
  try {
    step = JSON.parse(line);
  } catch {
    continue;
  }
  try {
    if (step.render === "hero") {
      renderHero();
      await ack(step.id);
    } else if (step.render === "approval") {
      renderApproval();
      await ack(step.id);
    } else if (step.render === "worker") {
      renderWorker();
      await ack(step.id);
    } else if (step.tokens) {
      await appendTokens(step.tokens);
      await ack(step.id);
    } else if (step.hook) {
      const p = hook(step.hook, { ...basePayload, ...step.payload });
      if (step.hook === "PermissionRequest") {
        void p.catch(() => {});
      } else {
        await p;
      }
      await ack(step.id);
    } else if (step.writeFile) {
      await writeFile(
        join(process.cwd(), step.writeFile.path),
        step.writeFile.content,
      );
      await ack(step.id);
    } else if (step.command) {
      const { stdout } = await run(ioriCommand(process.env.IORI_COMMAND_BIN), [
        ...step.command,
        "--json",
      ]);
      await ack(step.id, JSON.parse(stdout));
    }
  } catch (error) {
    await ack(step.id, { ok: false, error: String(error) });
  }
}
