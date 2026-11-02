/**
 * Output for a run with no arguments. The full system guide is written in a
 * later phase; for now it names the commands that exist.
 */
export function placeholderMarkdown(version: string): string {
  return [
    `# idc365-decisions CLI v${version}`,
    "",
    "This CLI is the interface to the idc365-decisions documentation repository.",
    "It is built for AI agents: every call prints markdown that names the next action.",
    "",
    "## Commands",
    "",
    "- `idc365-decisions adr|proc|tech|code`: what the type is, how to write it, and its verbs (`create`, `update`, `show`, `list`).",
    "- `idc365-decisions att`: attachments (binary files in Git LFS): create, show, list, get.",
    "- `idc365-decisions release`: releases, which release the current code branch belongs to, and recording a deployed version.",
    "- `idc365-decisions hook`: Claude Code integration: `hook install` in a code repository primes every session.",
    "- `idc365-decisions setup`: check the link file and the token.",
    "- `idc365-decisions validate [path] [--json]`: validate a documentation tree on disk.",
    "",
    "## Next action",
    "",
    "To check documentation, run `idc365-decisions validate` in the documentation repository root. Otherwise continue with your current task.",
    "",
  ].join("\n");
}
