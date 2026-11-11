import { checkWrittenText } from "./wording-common.mjs";

try {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  const input = JSON.parse(data);
  const entries = [];
  let current;
  for (const line of (input.tool_input?.command ?? "").split("\n")) {
    const header = line.match(/^\*\*\* (?:Add|Update) File: (.+)$/);
    if (header) {
      current = { file: header[1], lines: [] };
      entries.push(current);
    } else if (line.startsWith("*** Move to: ") && current) {
      current.file = line.slice("*** Move to: ".length);
    } else if (line.startsWith("*** ")) {
      current = undefined;
    } else if (current && line.startsWith("+")) {
      current.lines.push(line.slice(1));
    } else if (current && current.lines.at(-1) !== "") {
      current.lines.push("");
    }
  }
  const reason = await checkWrittenText(
    entries.map(({ file, lines }) => ({ file, text: lines.join("\n") })),
  );
  if (reason) console.log(JSON.stringify({ decision: "block", reason }));
} catch {
  // A hook failure must not interrupt development.
}
