import { checkWrittenText } from "./wording-common.mjs";

try {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  const input = JSON.parse(data);
  const tool = input.tool_input ?? {};
  const texts =
    input.tool_name === "Write"
      ? [tool.content]
      : input.tool_name === "Edit"
        ? [tool.new_string]
        : input.tool_name === "MultiEdit"
          ? (tool.edits ?? []).map((edit) => edit.new_string)
          : [];
  const reason = await checkWrittenText(
    texts
      .filter((text) => typeof text === "string")
      .map((text) => ({ file: tool.file_path, text })),
  );
  if (reason) console.log(JSON.stringify({ decision: "block", reason }));
} catch {
  // A hook failure must not interrupt development.
}
