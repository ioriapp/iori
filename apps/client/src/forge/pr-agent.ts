export type PrAgentPr = {
  number: number;
  title: string;
  baseBranch: string;
  headBranch: string;
};

export type PrAgentComment = {
  author: string;
  body: string;
  path?: string;
  line?: number;
  diffHunk?: string;
};

const MAX_DIFF_HUNK_LINES = 12;

function trimDiffHunk(raw: string, maxLines = MAX_DIFF_HUNK_LINES): string {
  const normalized = raw.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  const tail = lines.length > maxLines ? lines.slice(-maxLines) : lines;
  return tail.join("\n");
}

function formatSingleComment(
  comment: PrAgentComment,
  index: number,
  total: number,
): string {
  const author = comment.author.trim() || "unknown";
  const prefix = total > 1 ? `[${index + 1}/${total}] ` : "";
  const location = comment.path
    ? comment.line !== undefined
      ? ` on \`${comment.path}:${comment.line}\``
      : ` on \`${comment.path}\``
    : "";

  const lines: string[] = [`${prefix}Comment by ${author}${location}:`];

  if (comment.diffHunk) {
    const hunk = trimDiffHunk(comment.diffHunk);
    if (hunk.trim()) {
      lines.push("```diff", hunk, "```");
    }
  }

  const body = comment.body.replace(/\r\n/gu, "\n").trim();
  if (body) {
    lines.push(body);
  }

  return lines.join("\n");
}

/**
 * Format PR metadata and review/conversation comments into a structured prompt
 * block suitable for inserting into an Agent terminal.
 */
export function formatPrCommentsForAgent(
  pr: PrAgentPr,
  comments: ReadonlyArray<PrAgentComment>,
): string {
  const header = [
    `PR #${pr.number}: ${pr.title.trim()}`,
    `Branch: ${pr.baseBranch} ← ${pr.headBranch}`,
  ].join("\n");

  if (comments.length === 0) {
    return header;
  }

  const formattedComments = comments.map((comment, index) =>
    formatSingleComment(comment, index, comments.length),
  );

  return [header, ...formattedComments].join("\n\n");
}
