import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDocument } from "../docs/compose.js";
import { relativeLink } from "../docs/macros.js";
import { classifyPath, INVERSE_OF, isRecord, loadConfig, parseYaml, splitFrontmatter, validateTree, type Config, type Finding, type Relation } from "../engine/index.js";
import { branchHead, buildCommit, encodePath, GitHubError, readFile, type FileChange, type GitHubClient } from "../github/index.js";
import { markdownFiles } from "../index/build.js";

/** Forward type → the inverse the bot writes into the target (spec 4.3). relates-to is its own inverse. */
export const INVERSE_FOR: Record<string, string> = {
  ...Object.fromEntries(Object.entries(INVERSE_OF).map(([inverse, forward]) => [forward, inverse])),
  "relates-to": "relates-to",
};

/** Target state a forward relation sets on its target (spec 3.4, 4.3). amends: none. */
export const TARGET_STATE: Record<string, string> = { supersedes: "superseded" };

export interface Edit {
  /** Target document path. */
  file: string;
  key: string;
  add: Relation[];
  state?: string;
  /** Human summary of what the edit does and why. */
  reasons: string[];
}

interface Doc {
  file: string;
  key: string;
  fm: Record<string, unknown>;
}

function parse(text: string): { fm: Record<string, unknown>; body: string } | undefined {
  const split = splitFrontmatter(text);
  if (!split) return undefined;
  try {
    const fm = parseYaml(split.frontmatter);
    return isRecord(fm) ? { fm, body: split.body } : undefined;
  } catch {
    return undefined;
  }
}

function relations(fm: Record<string, unknown>): Relation[] {
  return (Array.isArray(fm.relations) ? fm.relations : []).filter((r): r is Relation => isRecord(r) && typeof r.target === "string" && typeof r.type === "string") as Relation[];
}

/** Every document in the checkout, by key. */
export function readTree(root: string, config: Config): Map<string, Doc> {
  const out = new Map<string, Doc>();
  for (const file of markdownFiles(root)) {
    const c = classifyPath(file, config);
    if (!c.key) continue;
    const p = parse(readFileSync(join(root, file), "utf8"));
    if (p) out.set(c.key, { file, key: c.key, fm: p.fm });
  }
  return out;
}

/**
 * The bot's follow-up edits for the documents in `changed` (paths), or for
 * every document with "all": for each forward relation to a document in the
 * tree, the matching inverse entry in the target, plus the target state.
 */
export function planEdits(docs: Map<string, Doc>, changed: Set<string> | "all"): Edit[] {
  const edits = new Map<string, Edit>();
  for (const d of docs.values()) {
    if (changed !== "all" && !changed.has(d.file)) continue;
    for (const r of relations(d.fm)) {
      const inverse = INVERSE_FOR[r.type];
      const target = docs.get(r.target);
      if (!inverse || !target || target.key === d.key) continue; // inverse types, Jira, URLs, self
      const edit = edits.get(target.key) ?? { file: target.file, key: target.key, add: [], reasons: [] };
      const has = relations(target.fm).some((t) => t.type === inverse && t.target === d.key) || edit.add.some((t) => t.type === inverse && t.target === d.key);
      if (!has) {
        edit.add.push({ type: inverse, target: d.key, why: r.why, link: relativeLink(target.file, d.file) });
        edit.reasons.push(`${inverse} ${d.key}`);
      }
      const state = TARGET_STATE[r.type];
      if (state && target.fm.state !== state && edit.state !== state) {
        edit.state = state;
        edit.reasons.push(`state ${state} (${d.key} ${r.type} it)`);
      }
      if (edit.add.length || edit.state) edits.set(target.key, edit);
    }
  }
  return [...edits.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Applies an edit to a file's text; returns the same text when there is nothing left to do. */
export function applyEdit(text: string, edit: Edit): string {
  const p = parse(text);
  if (!p) return text;
  const fm = { ...p.fm };
  const rels = relations(fm);
  let changed = false;
  for (const a of edit.add) {
    if (!rels.some((r) => r.type === a.type && r.target === a.target)) {
      rels.push(a);
      changed = true;
    }
  }
  if (edit.state && fm.state !== edit.state) {
    fm.state = edit.state;
    changed = true;
  }
  if (!changed) return text;
  const { relations: _old, ...rest } = fm;
  return renderDocument({ ...rest, relations: rels }, p.body);
}

/**
 * Hooks for the release lifecycle (phase 6): planned → development and
 * release-branch creation after a REL merge, release-branch deletion after a
 * release merge. Not implemented yet; returns no actions.
 */
export function releaseHooks(_docs: Map<string, Doc>, _changed: Set<string> | "all", _branch: string): string[] {
  return [];
}

export interface PostMergeResult {
  changed: string[] | "all";
  edits: Edit[];
  /** Findings of the tree with the edits applied; the bot commits only when empty. */
  findings: Finding[];
  commit?: string;
  /** "nothing" when no edit was needed (also after a concurrent run did them). */
  outcome: "nothing" | "committed" | "dry-run" | "invalid";
}

const ZERO = /^0+$/;

export function changedFiles(root: string, before: string | undefined, after: string): Set<string> | "all" {
  if (!before || ZERO.test(before)) return "all";
  try {
    const out = execFileSync("git", ["diff", "--name-only", before, after, "--", "docs", "code"], { cwd: root, encoding: "utf8" });
    return new Set(out.split("\n").filter(Boolean));
  } catch {
    return "all"; // before is unknown here (for example after a force push): check everything
  }
}

/**
 * The post-merge run for a truth branch: plan the edits for the pushed
 * documents, check that the tree with them validates, then commit them as
 * the bot in one commit on the current branch head. Idempotent: with nothing
 * to do it writes nothing, so the bot's own commit does not loop.
 */
export async function postMerge(opts: {
  root: string;
  branch: string;
  before?: string;
  after: string;
  client?: GitHubClient;
  dryRun?: boolean;
  maxAttempts?: number;
}): Promise<PostMergeResult> {
  const loaded = loadConfig(opts.root);
  if (!loaded.config) return { changed: [], edits: [], findings: loaded.findings, outcome: "invalid" };
  const docs = readTree(opts.root, loaded.config);
  const changed = changedFiles(opts.root, opts.before, opts.after);
  releaseHooks(docs, changed, opts.branch);
  const edits = planEdits(docs, changed);
  const changedList = changed === "all" ? "all" : [...changed].sort();
  if (edits.length === 0) return { changed: changedList, edits, findings: [], outcome: "nothing" };

  // The tree with the edits must validate clean before the bot writes anything.
  for (const e of edits) writeFileSync(join(opts.root, e.file), applyEdit(readFileSync(join(opts.root, e.file), "utf8"), e));
  const findings = validateTree(opts.root).findings;
  if (findings.length) return { changed: changedList, edits, findings, outcome: "invalid" };
  if (opts.dryRun || !opts.client) return { changed: changedList, edits, findings, outcome: "dry-run" };

  const client = opts.client;
  const message = `Post-merge: ${edits.map((e) => `${e.key} ← ${e.reasons.join(", ")}`).join("; ")}`;
  for (let attempt = 1; attempt <= (opts.maxAttempts ?? 5); attempt++) {
    const head = await branchHead(client, opts.branch);
    if (!head) throw new GitHubError(404, `branch ${opts.branch} no longer exists`, "Nothing to do.", `GET git/ref/heads/${opts.branch}`);
    // Apply the edits to the files as they are at the head now (another merge may have landed).
    const changes: FileChange[] = [];
    for (const e of edits) {
      const current = await readFile(client, e.file, head);
      if (!current) continue;
      const next = applyEdit(current.text(), e);
      if (next !== current.text()) changes.push({ path: e.file, content: next });
    }
    if (changes.length === 0) return { changed: changedList, edits, findings, outcome: "nothing" };
    const sha = await buildCommit(client, head, changes, message);
    const moved = await client.request("PATCH", client.repoPath(`/git/refs/heads/${encodePath(opts.branch)}`), { body: { sha, force: false }, allow: [422] });
    if (moved.status !== 422) return { changed: changedList, edits, findings, commit: sha, outcome: "committed" };
    // 422: the branch moved since we read it; retry on the new head.
  }
  throw new GitHubError(409, `could not commit the post-merge edits to ${opts.branch}`, "Run the post-merge workflow again.", `PATCH git/refs/heads/${opts.branch}`);
}
