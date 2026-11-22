import type { ConversationPlan } from "@iori/protocol";
import type { TeamCommand } from "./commands.ts";

type PlanCommand = Extract<TeamCommand, { kind: "plan" }>;

function insertionIndex(
  plan: ConversationPlan,
  command: { first: boolean; after?: number },
): number {
  if (command.first) return 0;
  if (command.after === undefined) return plan.tasks.length;
  const index = plan.tasks.findIndex((entry) => entry.number === command.after);
  if (index === -1)
    throw new Error("Plan task does not exist. Read iori plan show.");
  return index + 1;
}

export function applyPlanCommand(
  current: ConversationPlan,
  command: PlanCommand,
  at: number,
) {
  if (command.action === "show")
    return { plan: current, text: JSON.stringify(current, null, 2) };
  const plan: ConversationPlan = {
    ...current,
    tasks: current.tasks.map((task) => ({ ...task })),
    activity: [...current.activity],
  };
  const order = () => plan.tasks.map((task) => task.number).join(", ");
  let responseText: string;
  if (command.action === "goal") {
    plan.activity.push({
      at,
      kind: "goal",
      request: command.request,
      text: command.body,
      ...(plan.goal === undefined ? {} : { previousGoal: plan.goal }),
    });
    plan.goal = command.body;
    responseText = "Goal updated.";
  } else if (command.action === "add") {
    const number = Math.max(0, ...plan.tasks.map((task) => task.number)) + 1;
    const task = {
      number,
      title: command.title,
      state: "pending" as const,
      added:
        command.request || plan.tasks.some((task) => task.state !== "pending"),
      updatedAt: at,
    };
    plan.tasks.splice(insertionIndex(plan, command), 0, task);
    plan.activity.push({
      at,
      kind: "add",
      request: command.request,
      task: number,
      title: command.title,
    });
    responseText = `Plan task ${number}: added. Order: ${order()}.`;
  } else if (command.action === "move") {
    const fromIndex = plan.tasks.findIndex(
      (entry) => entry.number === command.number,
    );
    if (fromIndex === -1)
      throw new Error("Plan task does not exist. Read iori plan show.");
    if (command.after === command.number)
      throw new Error("Cannot move a plan task after itself.");
    const [moved] = plan.tasks.splice(fromIndex, 1);
    plan.tasks.splice(insertionIndex(plan, command), 0, moved!);
    responseText = `Plan task ${command.number}: moved. Order: ${order()}.`;
  } else {
    const task = plan.tasks.find((task) => task.number === command.number);
    if (!task)
      throw new Error("Plan task does not exist. Read iori plan show.");
    if (command.action === "cancel") {
      task.state = "cancelled";
      task.reason = command.reason;
    } else {
      if (
        (command.state === undefined || command.state === task.state) &&
        (command.checkpoint === undefined ||
          command.checkpoint === task.checkpoint) &&
        (command.title === undefined || command.title === task.title)
      )
        return { text: `Plan task ${task.number}: unchanged.`, plan: current };
      if (command.state !== undefined) task.state = command.state;
      if (command.checkpoint !== undefined)
        task.checkpoint = command.checkpoint;
      if (command.title !== undefined) task.title = command.title;
    }
    task.updatedAt = at;
    plan.activity.push({
      at,
      kind: command.action,
      request: false,
      task: task.number,
      ...(command.action === "cancel"
        ? { reason: command.reason }
        : {
            title: command.title,
            state: command.state,
            checkpoint: command.checkpoint,
          }),
    });
    responseText = `Plan task ${task.number}: ${command.action === "cancel" ? "cancelled" : "updated"}.`;
  }
  plan.updatedAt = at;
  return { text: responseText, plan };
}

export function startPlanTask(
  plan: ConversationPlan | undefined,
  number: number | undefined,
  at: number,
) {
  const task = plan?.tasks.find((entry) => entry.number === number);
  if (!plan || task?.state !== "pending") return plan;
  const state = "in_progress" as const;
  return {
    ...plan,
    tasks: plan.tasks.map((entry) =>
      entry === task ? { ...entry, state } : entry,
    ),
    activity: [
      ...plan.activity,
      {
        at,
        kind: "update" as const,
        request: false,
        by: "host" as const,
        task: task.number,
        state,
      },
    ],
  };
}
