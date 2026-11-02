import { DocRepo } from "../docs/docrepo.js";
import { validateDocuments } from "../engine/index.js";
import { branchHead, buildCommit, compareVersions, formatVersion, GitHubError, highestVersion, parseVersion, readFile, type FileChange, type GitHubClient } from "../github/index.js";
import { applyEdit, type Edit } from "../postmerge/postmerge.js";
import { listRels, tagNames } from "./release.js";

export interface TagResult {
  version: string;
  /** Bot commit with the phase changes, when any. */
  commit?: string;
  /** Commit the tag points at. */
  tagged: string;
  released?: string;
  retired: string[];
}

/**
 * The tag workflow's work (spec 7.2, run by docs-tag.yml with the bot token):
 * validate the version (strict semver, higher than every v* tag), set the
 * matching REL to `released` (with today's released_date) and the previously
 * released REL(s) to `retired` in one bot commit on main, then create the tag
 * on that commit. A version without its own REL (a patch) changes no phases.
 */
export async function applyTag(client: GitHubClient, version: string, today = new Date().toISOString().slice(0, 10), maxAttempts = 5): Promise<TagResult> {
  const v = parseVersion(version);
  if (!v) throw new GitHubError(422, `\`${version}\` is not a version like v1.2.0`, "Start the tag workflow with a full version vMAJOR.MINOR.PATCH.", "tag");
  const highest = highestVersion(await tagNames(client));
  if (highest && compareVersions(v, highest) <= 0) {
    throw new GitHubError(422, `${version} is not higher than the highest tag ${formatVersion(highest)}`, "Start the tag workflow with a higher version.", "tag");
  }
  const repo = new DocRepo(client);
  const rels = await listRels(client, "main", repo);
  const target = rels.find((r) => r.version === version);
  const edits: Edit[] = [];
  if (target) {
    edits.push({ file: target.file, key: target.id, add: [], set: { phase: "released", released_date: today }, reasons: ["phase released"] });
    for (const r of rels) if (r.id !== target.id && r.phase === "released") edits.push({ file: r.file, key: r.id, add: [], set: { phase: "retired" }, reasons: ["phase retired"] });
  }

  let commit: string | undefined;
  let tagged: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts && !tagged; attempt++) {
    const head = await branchHead(client, "main");
    if (!head) throw new GitHubError(404, "main does not exist", "Check the repository.", "GET git/ref/heads/main");
    const changes: FileChange[] = [];
    for (const e of edits) {
      const cur = await readFile(client, e.file, head);
      if (!cur) continue;
      const next = applyEdit(cur.text(), e);
      if (next !== cur.text()) changes.push({ path: e.file, content: next });
    }
    if (changes.length === 0) {
      tagged = head;
      break;
    }
    const { config, findings } = await repo.config(head);
    const invalid = config ? validateDocuments(config, changes.map((c) => ({ file: c.path, text: String(c.content) }))) : findings;
    // Only rule violations of the edited RELs themselves count (their targets are not loaded here).
    const own = invalid.filter((f) => !["relation.target", "link.path", "link.relation"].includes(f.rule));
    if (own.length) throw new GitHubError(422, `the phase change would not validate: ${own.map((f) => `${f.file} ${f.rule} ${f.message}`).join("; ")}`, "Fix the REL documents via PR, then start the tag workflow again.", "tag");
    const message = `Release ${version}: ${edits.map((e) => `${e.key} ${String(e.set?.phase)}`).join(", ")}`;
    const sha = await buildCommit(client, head, changes, message);
    const moved = await client.request("PATCH", client.repoPath("/git/refs/heads/main"), { body: { sha, force: false }, allow: [422] });
    if (moved.status === 422) continue; // main moved; retry on the new head
    commit = sha;
    tagged = sha;
  }
  if (!tagged) throw new GitHubError(409, "could not commit the phase changes to main", "Start the tag workflow again.", "PATCH git/refs/heads/main");
  await client.request("POST", client.repoPath("/git/refs"), { body: { ref: `refs/tags/${version}`, sha: tagged } });
  return { version, commit, tagged, released: target?.id, retired: edits.filter((e) => e.set?.phase === "retired").map((e) => e.key) };
}
