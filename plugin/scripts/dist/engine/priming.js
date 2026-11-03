/**
 * The SessionStart priming text (spec 9.3), shared by the hook that writes it
 * and the validator that keeps it within the budget.
 */
export const PRIMING_COMMANDS = [
    "- `idc365-decisions adr|proc|tech|code|att|release`: guide, then `list`, `show <ID>`, `create`, `update` (`--ref <branch>` to read a release).",
    "- `idc365-decisions tech check`: before adding or upgrading a dependency.",
    "- `idc365-decisions release current`: which release this code branch belongs to.",
    "- Write references as macros, for example `{{ADR:0042|<why>}}`; every write opens a PR that the user reviews and merges.",
];
/** The text before the featured documents. */
export function primingHead(v) {
    return [
        "# IDC365 decision system",
        "",
        `This project's architecture decisions (ADR), procedures (PROC), approved tech stack (TECH), releases (REL), attachments and code documentation live in the documentation repository \`${v.docs}\`. The \`idc365-decisions\` CLI is the only way to read and write it: run \`idc365-decisions\` for the guide. Only what is on the tech stack list may be used.`,
        ...(v.warnings.length ? ["", ...v.warnings.map((w) => `> ${w}`)] : []),
        "",
        "## This code branch",
        "",
        ...v.release,
        "",
        "## Most important commands",
        "",
        ...PRIMING_COMMANDS,
        "",
    ].join("\n");
}
/** One featured document in the priming. */
export function primingFeatured(id, title, body) {
    return `## Featured: ${id} ${title}\n\n${body.trim()}\n`;
}
/**
 * The fixed part the validator counts against the budget: the head with
 * realistic release lines and one warning, so featured documents leave room.
 */
export const PRIMING_FIXED_TEXT = primingHead({
    docs: "org/documentation-repository",
    release: [
        "- Code: `org/code-repository` branch `feature/some-branch-name`",
        "- Release: v10.20.30 (REL-0000, phase development), inherited from the mapped branch `release/10.20`",
        "- Documentation branch: `release/v10.20.30`: read with `--ref release/v10.20.30`",
    ],
    warnings: ["Primed from the cache of 2026-01-01T00:00Z: the documentation repository could not be reached (reason here). The content may be out of date."],
});
/** Characters as Unicode code points. */
export function charCount(text) {
    let n = 0;
    for (const _ of text)
        n++;
    return n;
}
