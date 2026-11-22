import type { CliSummary } from "@iori/protocol";
import type * as pty from "node-pty";
import { cliDefinitions, definitionInfo } from "../cli/definitions.ts";
import type { HookState } from "../cli/hooks.ts";
import type { TeamInputKey } from "../teams/commands.ts";
import type { TerminalSession } from "./terminal-session.ts";
import { terminalSubmitPaste } from "./terminal-submit.ts";
// Idle text-only Claude/Codex samples redraw in <=49ms; allow margin for output gaps.
const SUBMIT_QUIET_MS = 100;
const SUBMIT_NO_OUTPUT_MS = 300;
// Working Claude pauses <=442ms (p90 114ms); cap continuous redraw at 500ms.
const SUBMIT_MAX_WAIT_MS = 500;
function terminalInputKeySequence(
  key: TeamInputKey,
  applicationCursor: boolean,
): string {
  switch (key) {
    case "enter":
      return "\r";
    case "escape":
      return "\u001b";
    case "up":
      return applicationCursor ? "\u001bOA" : "\u001b[A";
    case "down":
      return applicationCursor ? "\u001bOB" : "\u001b[B";
    case "tab":
      return "\t";
    case "ctrl-c":
      return "\u0003";
  }
}
export function initialPromptReadyWhen(runtime: TerminalSession) {
  const definition = cliDefinitions.find((item) => item.id === runtime.cli?.id);
  const prompt =
    definition && definitionInfo(definition)?.file.launch.initialPrompt;
  return prompt?.mode === "paste" ? prompt.readyWhen : undefined;
}

interface InputEvents {
  stopping(): boolean;
  noteCliInput(
    session: TerminalSession,
    preserveBackgroundTasks?: boolean,
  ): void;
  updateCliState(session: TerminalSession, state?: HookState): void;
  saveCli(session: TerminalSession): void;
  reportRuntimeError(session: TerminalSession): void;
  delivered(id: string): void;
}
export class CliInput {
  readonly #events: InputEvents;
  constructor(events: InputEvents) {
    this.#events = events;
  }
  async sendCliInput(
    runtime: TerminalSession | undefined,
    input:
      | { text: string; enter?: boolean }
      | { key: TeamInputKey }
      | { sequence: string },
  ): Promise<boolean> {
    if (
      !runtime?.pty ||
      !runtime.cli ||
      runtime.stopped ||
      this.#events.stopping() ||
      runtime.ptyExited
    )
      return false;
    if ("text" in input && input.enter) {
      return this.submit(
        runtime,
        input.text,
        () => this.#events.noteCliInput(runtime),
        undefined,
        { holdOnWait: false, rawSingleLine: true },
      );
    }
    return runtime.runSerial(async () => {
      if (
        runtime.stopped ||
        this.#events.stopping() ||
        runtime.ptyExited ||
        !runtime.pty ||
        !runtime.cli
      )
        return false;
      const data =
        "sequence" in input
          ? input.sequence
          : "key" in input
            ? terminalInputKeySequence(
                input.key,
                runtime.modes.applicationCursor,
              )
            : /[\r\n]/u.test(input.text)
              ? terminalSubmitPaste(input.text, runtime.modes.bracketedPaste)
              : input.text;
      await runtime.pty.write(data);
      this.#events.noteCliInput(runtime);
      this.#events.updateCliState(
        runtime,
        runtime.hooks?.onInput?.(data, runtime.cliStatus),
      );
      return true;
    });
  }

  async sendLine(
    runtime: TerminalSession | undefined,
    line: string,
    delivered?: () => void,
    deliveryId?: string,
  ): Promise<"queued" | "delivered"> {
    if (!runtime?.pty || !runtime.cli)
      throw new Error("CLI is stopped. Resume the parent conversation first.");
    let wasDelivered = false;
    const message = {
      line,
      delivered: () => {
        wasDelivered = true;
        delivered?.();
      },
      deliveryId,
    };
    await runtime.runSerial(async () => {
      await runtime.ready;
      if (!runtime.pty || !runtime.cli || runtime.stopped)
        throw new Error(
          "CLI is stopped. Resume the parent conversation first.",
        );
      runtime.pendingLines.push(message);
      this.#events.saveCli(runtime);
      this.sendPendingLines(runtime);
    });
    // Output parsing shares the serial queue, so delivery must wait outside it.
    await runtime.delivery;
    if (wasDelivered) return "delivered";
    if (runtime.pendingLines.includes(message)) return "queued";
    throw new Error(
      "Input delivery was interrupted. Check the CLI screen before continuing.",
    );
  }

  submit(
    runtime: TerminalSession,
    text: string,
    beforeWrite?: () => void,
    onAccepted?: () => void,
    options?: {
      holdOnWait?: boolean;
      rawSingleLine?: boolean;
      preserveBackgroundTasks?: boolean;
    },
  ): Promise<boolean> {
    const holdOnWait = options?.holdOnWait !== false;
    const child = runtime.pty;
    const submission = (runtime.submission ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        let timer: NodeJS.Timeout | undefined;
        let deadline: NodeJS.Timeout | undefined;
        let output: pty.IDisposable | undefined;
        let exit: pty.IDisposable | undefined;
        if (!child) return false;
        let exited = false;
        // Text sent to an open question or approval is the user's answer; hold
        // the Enter only for a prompt that appears after the text was written.
        let writtenWhileWaiting = false;
        let writtenCli: CliSummary | undefined;
        let settle!: () => void;
        const redrawn = new Promise<void>((resolve) => {
          settle = resolve;
        });
        try {
          await runtime.runSerial(async () => {
            if (
              runtime.stopped ||
              this.#events.stopping() ||
              runtime.ptyExited ||
              runtime.pty !== child
            )
              return;

            output = child.onData(() => {
              if (
                runtime.stopped ||
                this.#events.stopping() ||
                runtime.ptyExited
              ) {
                settle();
                return;
              }
              if (timer) clearTimeout(timer);
              timer = setTimeout(settle, SUBMIT_QUIET_MS);
            });
            exit = child.onExit(() => {
              exited = true;
              settle();
              runtime.submissionStateChanged?.();
            });
            beforeWrite?.();
            writtenWhileWaiting = runtime.cliStatus?.state === "waiting";
            writtenCli = runtime.cli;
            deadline = setTimeout(settle, SUBMIT_MAX_WAIT_MS);
            const payload =
              options?.rawSingleLine && !/[\r\n]/u.test(text)
                ? text
                : terminalSubmitPaste(text, runtime.modes.bracketedPaste);
            await child.write(payload);
            this.#events.noteCliInput(
              runtime,
              options?.preserveBackgroundTasks,
            );
            onAccepted?.();
            if (!timer) timer = setTimeout(settle, SUBMIT_NO_OUTPUT_MS);
          });
          if (!output) return false;
          await redrawn;
          if (timer) clearTimeout(timer);
          if (deadline) clearTimeout(deadline);
          output.dispose();
          for (;;) {
            let changed!: Promise<void>;
            const sent = await runtime.runSerial(async () => {
              if (
                exited ||
                runtime.stopped ||
                this.#events.stopping() ||
                runtime.ptyExited ||
                runtime.pty !== child ||
                // The CLI ended while the Enter was held; do not reach the shell.
                (writtenCli && !runtime.cli)
              )
                return false;
              if (
                holdOnWait &&
                !writtenWhileWaiting &&
                runtime.cliStatus?.state === "waiting"
              ) {
                // Hooks and lifecycle changes wake this wait outside the serial queue.
                changed = new Promise<void>((resolve) => {
                  runtime.submissionStateChanged = resolve;
                });
                return undefined;
              }
              await child.write("\r");
              this.#events.noteCliInput(
                runtime,
                options?.preserveBackgroundTasks,
              );
              this.#events.updateCliState(
                runtime,
                runtime.hooks?.onInput?.("\r", runtime.cliStatus),
              );
              return true;
            });
            if (sent !== undefined) return sent;
            await changed;
          }
        } finally {
          if (timer) clearTimeout(timer);
          if (deadline) clearTimeout(deadline);
          output?.dispose();
          exit?.dispose();
          runtime.submissionStateChanged = undefined;
        }
      });
    runtime.submission = submission;
    void submission
      .finally(() => {
        if (runtime.submission === submission) runtime.submission = undefined;
      })
      .catch(() => {});
    return submission;
  }

  sendInitialInput(runtime: TerminalSession): void {
    if (runtime.setup || !runtime.cliReady || !runtime.initialInput) return;
    runtime.pendingLines.unshift({ line: runtime.initialInput });
    runtime.initialInput = undefined;
    this.sendPendingLines(runtime);
  }

  sendPendingLines(runtime: TerminalSession): void {
    const waitForBracketedPaste = cliDefinitions.find(
      (definition) => definition.id === runtime.cli?.id,
    )?.waitForBracketedPaste;
    if (
      runtime.setup ||
      runtime.cliStatus?.state === "waiting" ||
      (runtime.teamOptions &&
        ((waitForBracketedPaste &&
          (!runtime.inputModeReady ||
            // Startup probes can disable paste again before the input UI mounts.
            !runtime.modes.bracketedPaste)) ||
          (initialPromptReadyWhen(runtime) && !runtime.cliReady) ||
          (runtime.hooks?.isSessionStart && !runtime.cliReady))) ||
      !runtime.pty ||
      !runtime.cli ||
      runtime.stopped ||
      this.#events.stopping()
    )
      return;
    if (runtime.delivery) return;
    runtime.delivery = (async () => {
      while (runtime.pendingLines.length) {
        const message = runtime.pendingLines[0]!;
        if (
          !(await this.submit(
            runtime,
            message.line,
            () => {
              // Once writing starts, an interrupted delivery must never be replayed.
              runtime.pendingLines.shift();
              this.#events.saveCli(runtime);
            },
            undefined,
            {
              // Internal reminders repeat until the CLI itself produces an event.
              preserveBackgroundTasks:
                message.deliveryId?.startsWith("background-wake:"),
            },
          ))
        )
          return;
        message.delivered?.();
        if (message.deliveryId) this.#events.delivered(message.deliveryId);
        this.#events.saveCli(runtime);
      }
    })()
      .catch(() => this.#events.reportRuntimeError(runtime))
      .finally(() => {
        runtime.delivery = undefined;
      });
  }
}
