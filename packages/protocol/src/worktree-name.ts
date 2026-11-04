/**
 * A title in ASCII letters, digits and hyphens for a worktree's name: runs of
 * other characters become one hyphen, in lower case, and a longer title is cut
 * at the last hyphen within 24 characters, not inside a word; a first word
 * longer than that is cut at 24. Empty when nothing of the title remains.
 */
export function worktreeTitleSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .toLowerCase()
    .replace(/^-|-$/gu, "");
  if (slug.length <= 24) return slug;
  // A hyphen right after the 24th character still ends a whole word.
  const end = slug.slice(0, 25).lastIndexOf("-");
  return slug.slice(0, end < 0 ? 24 : end);
}

/**
 * The worktree name "Start with this Issue" proposes (forge.md「Issueから始める」):
 * the number and the title shaped as `delegate --worktree new` shapes it when
 * the title is all ASCII, otherwise `issue-<number>`.
 */
export function issueWorktreeName(number: number, title: string): string {
  // ASCII is the whole 7-bit range: letters, digits, spaces and symbols.
  const slug = /^[\x00-\x7f]*$/u.test(title) ? worktreeTitleSlug(title) : "";
  return slug ? `${number}-${slug}` : `issue-${number}`;
}
