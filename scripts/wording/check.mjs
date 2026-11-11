import { globSync, readFileSync } from "node:fs";
import { findTerms, readTerms } from "./terms.mjs";

const terms = readTerms(readFileSync("docs/design/wording.md", "utf8"));
const files = globSync([
  "AGENTS.md",
  "CLAUDE.md",
  "DEVELOPMENT.md",
  "README.ja.md",
  "docs/**/*.md",
  "guides/*.ja.md",
  "verification/**/*.md",
  ".forgejo/*.md",
])
  .filter((file) => file !== "docs/design/wording.md")
  .sort();
let count = 0;
for (const file of files) {
  for (const match of findTerms(readFileSync(file, "utf8"), terms)) {
    console.log(`${file}:${match.line}: ${match.banned} → ${match.use}`);
    count++;
  }
}
if (count) process.exitCode = 1;
