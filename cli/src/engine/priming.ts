/**
 * Placeholder for the fixed part of the SessionStart priming text (spec 9.3).
 * The real text is written in the hook phase; the budget check already counts
 * this placeholder so featured documents leave room for it.
 */
export const PRIMING_FIXED_TEXT = [
  "# IDC365 decision system",
  "",
  "This project's decisions, procedures, approved tech stack and releases live in the",
  "idc365-decisions documentation repository. Use the `idc365-decisions` CLI for all",
  "documentation: run it with no arguments to see what to do.",
  "",
  "Release and documentation branch: <resolved at session start>.",
  "",
  "## Most important commands",
  "",
  "<command list>",
  "",
  "## Featured documents",
  "",
].join("\n");

/** Characters as Unicode code points. */
export function charCount(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}
