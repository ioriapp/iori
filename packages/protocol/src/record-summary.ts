import type { RecordedCandidate, TaskRecord } from "./board.ts";
export function candidateKey(
  role: string | undefined,
  candidate: RecordedCandidate,
): string {
  return JSON.stringify([
    role,
    candidate.cli,
    candidate.model ?? "",
    candidate.effort ?? "",
  ]);
}
export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
export type CandidateSummary = {
  key: string;
  role?: string;
  candidate: RecordedCandidate;
  taskIds: string[];
  tasks: number;
  agents: number;
  decided: number;
  firstAccepted: number;
  rejected: number;
  revisions: number;
  time?: number;
  tokens?: number;
  measuredTokens: number;
  input?: number;
  output?: number;
  cacheHit?: number;
  measuredCache: number;
};
/** Task outcomes belong to the first assignee; measurements and revisions belong
 * to each actual child, including children that take over an existing task. */
export function summarizeRecords(tasks: TaskRecord[]): CandidateSummary[] {
  const groups = new Map<
    string,
    CandidateSummary & {
      times: number[];
      amounts: number[];
      inputs: number[];
      outputs: number[];
      cacheInput: number;
      cacheRead: number;
    }
  >();
  for (const task of tasks) {
    const first = task.agents[0];
    for (const child of task.agents) {
      if (!child.candidate) continue;
      const key = candidateKey(child.role, child.candidate);
      let row = groups.get(key);
      if (!row) {
        row = {
          key,
          role: child.role,
          candidate: child.candidate,
          taskIds: [],
          tasks: 0,
          agents: 0,
          decided: 0,
          firstAccepted: 0,
          rejected: 0,
          revisions: 0,
          measuredTokens: 0,
          measuredCache: 0,
          inputs: [],
          outputs: [],
          cacheInput: 0,
          cacheRead: 0,
          times: [],
          amounts: [],
        };
        groups.set(key, row);
      }
      if (!row.taskIds.includes(task.id)) row.taskIds.push(task.id);
      row.agents++;
      row.revisions += child.revisions;
      const time = child.workMs ?? child.elapsedMs;
      if (time !== undefined) row.times.push(time);
      if (child.tokens !== undefined) {
        row.amounts.push(child.tokens.input + child.tokens.output);
        row.inputs.push(child.tokens.input);
        row.outputs.push(child.tokens.output);
        if (child.tokens.cacheRead !== undefined) {
          row.measuredCache++;
          row.cacheInput += child.tokens.input;
          row.cacheRead += child.tokens.cacheRead;
        }
      }
      if (child === first) {
        row.tasks++;
        if (task.decision) row.decided++;
        if (task.decision === "accept" && task.revisions === 0)
          row.firstAccepted++;
        if (task.decision === "reject") row.rejected++;
      }
    }
  }
  return [...groups.values()].map(
    ({ times, amounts, inputs, outputs, cacheInput, cacheRead, ...row }) => ({
      ...row,
      input: median(inputs),
      output: median(outputs),
      cacheHit: cacheInput > 0 ? cacheRead / cacheInput : undefined,
      time: median(times),
      tokens: median(amounts),
      measuredTokens: amounts.length,
    }),
  );
}

/** Use the same child measurements as Time, summed for the task list. */
export function taskWorkTime(task: TaskRecord): number | undefined {
  if (!task.agents.some((child) => child.workMs !== undefined))
    return task.elapsedMs;
  const times = task.agents.flatMap((child) => {
    const time = child.workMs ?? child.elapsedMs;
    return time === undefined ? [] : [time];
  });
  return times.reduce((sum, time) => sum + time, 0);
}
