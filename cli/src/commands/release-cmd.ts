import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { KINDS } from "../docs/kinds.js";
import { showDocument } from "../docs/read.js";
import { GitHubClient, GitHubError, parseVersion } from "../github/index.js";
import { createRelease, currentRelease, docsTagFor, listRels, mapRelease, tagInstructions, tagNames, type CodeMapping } from "../release/release.js";
import { applyTag } from "../release/tag.js";
import { loadSetup, renderSetupProblems } from "../setup/setup.js";
import { renderRefusal, renderWrite } from "./docs.js";
import { clientFor } from "./index-cmd.js";

const CLI = "idc365-decisions";

function md(title: string, lines: string[], next: string): string {
  return [`# ${title}`, "", ...lines, ...(lines.length ? [""] : []), "## Next action", "", next, ""].join("\n");
}

function print(json: boolean, data: unknown, markdown: string): void {
  process.stdout.write(json ? JSON.stringify(data, null, 2) + "\n" : markdown);
}

async function withClient(json: boolean, fn: (client: GitHubClient) => Promise<number>): Promise<void> {
  const setup = loadSetup(process.cwd());
  if (!setup.ok) {
    print(json, { ok: false, error: "setup incomplete", problems: setup.problems }, renderSetupProblems(setup.problems));
    process.exitCode = 1;
    return;
  }
  try {
    process.exitCode = await fn(new GitHubClient({ repository: setup.setup.repository, token: setup.setup.token }));
  } catch (err) {
    if (!(err instanceof GitHubError)) throw err;
    print(json, { ok: false, error: err.message, nextAction: err.nextAction }, md("GitHub error", [`- ${err.message}`, ...err.details.map((d) => `  ${d}`)], err.nextAction));
    process.exitCode = 1;
  }
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseCode(specs: string[] | undefined): CodeMapping[] | string {
  const out: CodeMapping[] = [];
  for (const s of specs ?? []) {
    const m = /^([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)=(\S+)$/.exec(s);
    if (!m) return `\`--code ${s}\` must be org/repo=branch`;
    out.push({ repo: m[1]!, branch: m[2]! });
  }
  return out;
}

const HELP = [
  KINDS.release.purpose,
  "",
  "## Verbs",
  "",
  `- \`${CLI} release create vX.Y.Z [--code org/repo=branch] [--jira-fix-version …] [--planned-date YYYY-MM-DD]\`: the REL in a PR to main; after the merge the bot creates \`release/vX.Y.Z\`.`,
  `- \`${CLI} release map --repo org/repo --branch <code branch> <REL-ID>\`: map a long-lived code branch to a release (PR).`,
  `- \`${CLI} release list [--ref main]\`, \`${CLI} release show <REL-ID> [--ref main]\``,
  `- \`${CLI} release current\`: which release the current code branch belongs to (run in the code repository).`,
  `- \`${CLI} release for vX.Y.Z\`: which documentation tag applies to a product version.`,
  `- \`${CLI} release tag vX.Y.Z\`: how a human starts the tag workflow (the CLI never tags).`,
];

/** Registers `release` and its verbs (spec 7.2, 7.3). */
export function registerReleaseCommands(program: Command): void {
  const release = program
    .command("release")
    .enablePositionalOptions()
    .action(() => {
      process.stdout.write(md("Releases", HELP, `Run \`${CLI} release current\` in a code repository to see which release it belongs to.`));
    });
  release.helpInformation = () => `Run \`${CLI} release\` for the release guide.\n`;

  release
    .command("create")
    .argument("<version>", "vX.Y.Z")
    .option("--code <org/repo=branch>", "code mapping, repeat per repository", collect)
    .option("--jira-fix-version <name>")
    .option("--planned-date <YYYY-MM-DD>")
    .option("--title <text>")
    .option("--description <text>")
    .option("--intent <text>")
    .option("--when <text>")
    .option("--body-file <path>")
    .option("--json")
    .action(async (version: string, o: Record<string, unknown>) => {
      const json = !!o.json;
      const code = parseCode(o.code as string[] | undefined);
      if (typeof code === "string") {
        print(json, { ok: false, message: code }, renderRefusal({ ok: false, message: code, nextAction: "Write each mapping as org/repo=branch." }));
        process.exitCode = 1;
        return;
      }
      await withClient(json, async (client) => {
        const body = o.bodyFile ? readFileSync(o.bodyFile === "-" ? 0 : String(o.bodyFile), "utf8") : undefined;
        const r = await createRelease(client, version, { code, jiraFixVersion: o.jiraFixVersion as string | undefined, plannedDate: o.plannedDate as string | undefined, title: o.title as string | undefined, description: o.description as string | undefined, intent: o.intent as string | undefined, when: o.when as string | undefined, body });
        let text = renderWrite(KINDS.release, r);
        if (r.ok) {
          text = text.replace(
            "## Next action\n\n",
            `## Next action\n\nAfter the merge the bot creates \`release/${version}\` and sets the phase to development. Tell the user which long-lived code branch each code repository needs for ${version} (the CLI never touches code repositories), and map it with \`${CLI} release map --repo <org/repo> --branch <branch> ${r.key}\`.\n`,
          );
        }
        print(json, r, text);
        return r.ok ? 0 : 1;
      });
    });

  release
    .command("map")
    .argument("<rel>", "REL-ID")
    .requiredOption("--repo <org/repo>")
    .requiredOption("--branch <branch>", "long-lived code branch")
    .option("--json")
    .action(async (rel: string, o: { repo: string; branch: string; json?: boolean }) => {
      await withClient(!!o.json, async (client) => {
        const r = await mapRelease(client, rel, o.repo, o.branch);
        print(!!o.json, r, renderWrite(KINDS.release, r));
        return r.ok ? 0 : 1;
      });
    });

  release
    .command("list")
    .option("--ref <ref>", "branch or tag", "main")
    .option("--json")
    .action(async (o: { ref: string; json?: boolean }) => {
      await withClient(!!o.json, async (client) => {
        const rels = await listRels(client, o.ref);
        const lines = rels.length ? rels.map((r) => `- ${r.id} · ${r.version} · ${r.phase} · docs \`${r.docsBranch}\`${r.code.length ? ` · code ${r.code.map((c) => `${c.repo}@${c.branch}`).join(", ")}` : ""}`) : ["No releases."];
        print(!!o.json, { ok: true, ref: o.ref, releases: rels.map(({ fm: _f, ...r }) => r) }, md(`Releases at \`${o.ref}\``, lines, `Show one with \`${CLI} release show <REL-ID>\`.`));
        return 0;
      });
    });

  release
    .command("show")
    .argument("<rel>")
    .option("--ref <ref>", "branch or tag", "main")
    .option("--json")
    .action(async (rel: string, o: { ref: string; json?: boolean }) => {
      await withClient(!!o.json, async (client) => {
        const r = await showDocument(client, KINDS.release, rel, o.ref);
        print(!!o.json, r, r.ok ? [`# ${r.key} at \`${r.ref}\``, "", `File: \`${r.file}\``, "", "````markdown", r.text.replace(/\n$/, ""), "````", "", "## Next action", "", "Use the release for your task.", ""].join("\n") : renderRefusal(r));
        return r.ok ? 0 : 1;
      });
    });

  release
    .command("for")
    .argument("<version>", "product version vX.Y.Z")
    .option("--json")
    .action(async (version: string, o: { json?: boolean }) => {
      await withClient(!!o.json, async (client) => {
        const v = parseVersion(version);
        if (!v) {
          print(!!o.json, { ok: false, message: "not a version" }, renderRefusal({ ok: false, message: `\`${version}\` is not a version like v2.1.3`, nextAction: "Use vMAJOR.MINOR.PATCH." }));
          return 1;
        }
        const tag = docsTagFor(v, await tagNames(client));
        print(
          !!o.json,
          { ok: true, version, tag: tag ?? null },
          tag
            ? md(`Documentation for ${version}: \`${tag}\``, [`The highest documentation tag at or below ${version} is \`${tag}\`.`], `Read the documents with \`--ref ${tag}\`, for example \`${CLI} adr list --ref ${tag}\`.`)
            : md(`No documentation tag at or below ${version}`, [], "Read `main`; no release has been tagged yet."),
        );
        return 0;
      });
    });

  release
    .command("tag")
    .argument("<version>", "vX.Y.Z")
    .option("--json")
    .action(async (version: string, o: { json?: boolean }) => {
      await withClient(!!o.json, async (client) => {
        const r = await tagInstructions(client, version);
        if (!r.ok) {
          print(!!o.json, r, renderRefusal(r));
          return 1;
        }
        const lines = [
          `- Version ${r.version} is valid (highest tag now: ${r.released ?? "none"}).`,
          `- ${r.rel ? `${r.rel} will be set to \`released\`, and the previously released REL to \`retired\`.` : "No REL has this version (a patch): no phases change."}`,
          "- Only a human starts the tag workflow, when the product is actually deployed. The CLI cannot and does not start it.",
          "",
          `In GitHub: open ${r.url}, choose **Run workflow** on \`main\` and enter \`${r.version}\`.`,
          "",
          "Or in a terminal, with the person's own GitHub access:",
          "",
          "```sh",
          r.command,
          "```",
        ];
        print(!!o.json, r, md(`Tag ${r.version}: a human starts the workflow`, lines, "Ask the user to start the tag workflow as shown above when the product is deployed. Do not start it yourself."));
        return 0;
      });
    });

  release
    .command("current")
    .option("--json")
    .action(async (o: { json?: boolean }) => {
      await withClient(!!o.json, async (client) => {
        const r = await currentRelease(client, process.cwd());
        if (!r.ok) {
          print(!!o.json, r, md("No release for this branch (orphaned)", [`- ${r.message}`], r.nextAction));
          return 1;
        }
        const lines = [
          `- Code: \`${r.repo}\` branch \`${r.branch}\``,
          `- Release: ${r.rel.id} (${r.rel.version}, phase ${r.rel.phase})`,
          `- Resolved: ${r.how === "direct" ? `the branch is mapped in ${r.rel.id}` : `inherited from the mapped branch \`${r.mappedBranch}\` (git merge-base)`}`,
          `- Documentation branch: \`${r.docsBranch}\`${r.docsBranchExists ? "" : ` (\`${r.rel.docsBranch}\` does not exist; using main)`}`,
        ];
        print(!!o.json, { ok: true, how: r.how, rel: r.rel.id, version: r.rel.version, phase: r.rel.phase, repo: r.repo, branch: r.branch, mappedBranch: r.mappedBranch, docsBranch: r.docsBranch }, md(`Release ${r.rel.version} (${r.rel.id})`, lines, `Work with version ${r.rel.version} and read documents from \`${r.docsBranch}\` (\`--ref ${r.docsBranch}\`).`));
        return 0;
      });
    });

  // Run by the tag workflow with the bot token; agents use `release tag`.
  const apply = release
    .command("apply-tag")
    .argument("<version>")
    .option("--repository <owner/repo>")
    .option("--json")
    .action(async (version: string, o: { repository?: string; json?: boolean }) => {
      const client = clientFor(o.repository);
      if (!(client instanceof GitHubClient)) {
        print(!!o.json, { ok: false, ...client }, md(`Cannot tag: ${client.error}`, [], client.nextAction));
        process.exitCode = 1;
        return;
      }
      try {
        const r = await applyTag(client, version);
        const lines = [`- Tag \`${r.version}\` at ${r.tagged}`, `- ${r.released ? `${r.released} released` : "no REL for this version: no phases changed"}`, ...r.retired.map((x) => `- ${x} retired`), ...(r.commit ? [`- Bot commit ${r.commit}`] : [])];
        print(!!o.json, { ok: true, ...r }, md(`Tagged ${r.version}`, lines, "None."));
      } catch (err) {
        if (!(err instanceof GitHubError)) throw err;
        print(!!o.json, { ok: false, error: err.message, nextAction: err.nextAction }, md(`Tag ${version} refused`, [`- ${err.message}`], err.nextAction));
        process.exitCode = 1;
      }
    });
  apply.helpInformation = () => "Run by the tag workflow. Use `idc365-decisions release tag vX.Y.Z` instead.\n";
}
