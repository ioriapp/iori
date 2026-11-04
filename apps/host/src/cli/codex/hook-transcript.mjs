// Codex turn context owns the approval reviewer. Scan newest records first;
// long conversations must not be read from the beginning on every approval.
import { open } from "node:fs/promises";
export async function preparePayload(payload) {
  if (!payload.transcript_path) return;
  const needReviewer = payload.hook_event_name === "PermissionRequest";
  let file;
  try {
    file = await open(payload.transcript_path, "r");
    let position = (await file.stat()).size;
    // Keep the start boundary with the hook while Host is disconnected. The
    // daemon can replay it after Codex has already written the error record.
    if (payload.hook_event_name === "UserPromptSubmit")
      payload.iori_rollout_offset = position;
    let remainder = Buffer.alloc(0);
    while (position > 0) {
      const length = Math.min(position, 64 * 1024);
      position -= length;
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, position);
      const combined = Buffer.concat([chunk, remainder]);
      let end = combined.length;
      for (let index = combined.length - 1; index >= 0; index--) {
        if (combined[index] !== 10 && !(position === 0 && index === 0))
          continue;
        const start = combined[index] === 10 ? index + 1 : 0;
        try {
          const item = JSON.parse(
            combined.subarray(start, end).toString("utf8"),
          );
          const reviewer =
            item.type === "turn_context"
              ? item.payload?.approvals_reviewer
              : item.type === "event_msg" &&
                  item.payload?.type === "thread_settings_applied"
                ? item.payload.thread_settings?.approvals_reviewer
                : undefined;
          const model =
            item.type === "turn_context"
              ? item.payload?.model
              : item.type === "event_msg" &&
                  item.payload?.type === "thread_settings_applied"
                ? item.payload.thread_settings?.model
                : undefined;
          if (!payload.model && typeof model === "string")
            payload.model = model;
          if (reviewer && !payload.approvals_reviewer)
            payload.approvals_reviewer = reviewer;
          if (payload.model && (!needReviewer || payload.approvals_reviewer))
            return;
        } catch {
          /* Empty or interrupted final lines carry no settings. */
        }
        end = index;
      }
      remainder = combined.subarray(0, end);
    }
  } catch {
    /* Missing context is no evidence of automatic approval. */
  } finally {
    await file?.close();
  }
}
