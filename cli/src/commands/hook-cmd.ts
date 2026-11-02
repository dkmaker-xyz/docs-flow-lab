import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { findGitRoot } from "../docs/gitrepo.js";
import { HOOK_ARGS, HOOK_COMMAND, mergeHook, removeHook } from "../hook/settings.js";
import { hookOutput, prime } from "../hook/prime.js";
import { checkForUpdate, npmView, packageTarget, updateNotice, type Viewer } from "../hook/update.js";
import { cacheDir } from "../index/read.js";
import { LINK_FILE, loadSetup, TOKEN_ENV } from "../setup/setup.js";
import { checkAccess } from "./setup.js";

const CLI = "idc365-decisions";
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

function md(title: string, lines: string[], next: string): string {
  return [`# ${title}`, "", ...lines, ...(lines.length ? [""] : []), "## Next action", "", next, ""].join("\n");
}

function print(json: boolean, data: unknown, markdown: string): void {
  process.stdout.write(json ? JSON.stringify(data, null, 2) + "\n" : markdown);
}

const HELP = [
  "Claude Code integration (spec 9). The SessionStart hook primes every session",
  "(startup, resume, clear, compact) with the system, the release and documentation",
  "branch of the current code branch, the most important commands and the",
  "featured documents.",
  "",
  `- \`${CLI} hook install [--repository <org>/<repo>]\`: in a code repository: merge the hook into \`.claude/settings.json\`, create \`${LINK_FILE}\`, check token, access and npm access. Never writes \`CLAUDE.md\`.`,
  `- \`${CLI} hook uninstall\`: remove only this hook from \`.claude/settings.json\`.`,
  `- \`${CLI} hook session-start\`: the hook itself (reads the SessionStart JSON on stdin, prints the priming JSON). Run it by hand to see the priming.`,
];

type Check = { item: string; ok: boolean; detail: string; fix?: string };

function readSettings(file: string): { settings: Record<string, unknown> } | { error: string } {
  if (!existsSync(file)) return { settings: {} };
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return { error: "it is not a JSON object" };
    return { settings: data as Record<string, unknown> };
  } catch (err) {
    return { error: `it is not valid JSON (${(err as Error).message})` };
  }
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export interface InstallOptions {
  repository?: string;
  json?: boolean;
  /** Injected in tests. */
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  view?: Viewer;
  prompt?: (q: string) => Promise<string>;
  interactive?: boolean;
  version?: string;
}

/** `hook install`. Returns the exit code: 0 everything is ready, 1 something is missing (listed). */
export async function runInstall(cwd: string, o: InstallOptions): Promise<number> {
  const env = o.env ?? process.env;
  const json = !!o.json;
  const root = findGitRoot(cwd);
  if (!root) {
    print(json, { ok: false, error: "not in a git repository" }, md("Hook not installed", ["- This folder is not inside a git repository."], `Run \`${CLI} hook install\` in the root of the code repository.`));
    return 1;
  }
  const checks: Check[] = [];

  // 1. Settings.
  const settingsFile = join(root, ".claude", "settings.json");
  const read = readSettings(settingsFile);
  if ("error" in read) {
    print(json, { ok: false, error: `${settingsFile}: ${read.error}` }, md("Hook not installed", [`- \`.claude/settings.json\` cannot be read: ${read.error}. Nothing was changed.`], "Fix the JSON of `.claude/settings.json` (or ask the user), then run the command again."));
    return 1;
  }
  const merged = mergeHook(read.settings);
  if ("error" in merged) {
    print(json, { ok: false, error: merged.error }, md("Hook not installed", [`- \`.claude/settings.json\`: ${merged.error}. Nothing was changed.`], "Correct the `hooks` section by hand (see the Claude Code hooks documentation), then run the command again."));
    return 1;
  }
  if (merged.changed) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(merged.settings, null, 2) + "\n");
  }
  checks.push({ item: "Hook", ok: true, detail: `${merged.changed ? "merged into" : "already in"} \`.claude/settings.json\` (SessionStart, exec form \`${HOOK_COMMAND} ${HOOK_ARGS.join(" ")}\`, no matcher: startup, resume, clear, compact)` });

  // 2. Link file.
  const linkFile = join(root, LINK_FILE);
  let createdLink = false;
  if (existsSync(linkFile)) {
    let current: string | undefined;
    try {
      current = (JSON.parse(readFileSync(linkFile, "utf8")) as { repository?: string }).repository;
    } catch {
      current = undefined;
    }
    if (o.repository && current !== o.repository) checks.push({ item: "Link file", ok: false, detail: `\`${LINK_FILE}\` names \`${current ?? "nothing valid"}\`, not \`${o.repository}\`; it was left unchanged`, fix: `Ask the user which documentation repository applies and edit \`${LINK_FILE}\` by hand.` });
    else checks.push({ item: "Link file", ok: !!current, detail: current ? `\`${LINK_FILE}\` names \`${current}\`` : `\`${LINK_FILE}\` is not valid`, fix: current ? undefined : `Make it contain exactly \`{"repository": "<org>/<documentation-repo>"}\`.` });
  } else {
    let repository = o.repository;
    if (!repository && (o.interactive ?? process.stdin.isTTY)) repository = await (o.prompt ?? ask)("Documentation repository (org/repo): ");
    if (repository && !REPO_RE.test(repository)) checks.push({ item: "Link file", ok: false, detail: `\`${repository}\` is not of the form org/repo; \`${LINK_FILE}\` was not created`, fix: `Run \`${CLI} hook install --repository <org>/<documentation-repo>\`.` });
    else if (repository) {
      writeFileSync(linkFile, JSON.stringify({ repository }, null, 2) + "\n");
      createdLink = true;
      checks.push({ item: "Link file", ok: true, detail: `created \`${LINK_FILE}\` naming \`${repository}\`` });
    } else checks.push({ item: "Link file", ok: false, detail: `\`${LINK_FILE}\` is missing`, fix: `Ask the user for the documentation repository and run \`${CLI} hook install --repository <org>/<documentation-repo>\`.` });
  }

  // 3. Token and access (as `setup`).
  const setup = loadSetup(root, env);
  const token = env[TOKEN_ENV]?.trim();
  if (!token) checks.push({ item: "Token", ok: false, detail: `\`${TOKEN_ENV}\` is not set`, fix: `Create a fine-grained personal access token as described in the CLI README, section "Documentation token", export it as \`${TOKEN_ENV}\` in the shell profile, and restart Claude Code.` });
  else if (setup.ok) {
    const access = await checkAccess(setup.setup.repository, setup.setup.token, o.fetch);
    checks.push(access.ok ? { item: "Token", ok: true, detail: `\`${TOKEN_ENV}\` is set and can read and write \`${setup.setup.repository}\`` } : { item: "Token", ok: false, detail: access.message, fix: access.nextAction });
  } else checks.push({ item: "Token", ok: true, detail: `\`${TOKEN_ENV}\` is set (access not checked: the link file is missing)` });

  // 4. npm access to the package registry (needed for updates), and the update check.
  const target = packageTarget(env);
  const view = await (o.view ?? npmView)(target, 15000);
  checks.push(view.ok ? { item: "npm", ok: true, detail: `\`${target.name}\` is readable on ${target.registry} (latest ${view.version})` } : { item: "npm", ok: false, detail: `\`npm view ${target.name}\` on ${target.registry} failed: ${view.error}`, fix: `Log in to the registry as described in the CLI README, section "Install" (\`npm login --scope=${target.name.split("/")[0]} --registry=${target.registry}\`), then run \`${CLI} hook install\` again.` });

  const notice = view.ok ? updateNotice(await checkForUpdate(o.version ?? version, { dir: cacheDir(env), env, view: async () => view, force: true })) : undefined;
  const missing = checks.filter((c) => !c.ok);
  const lines = [
    ...checks.map((c) => `- ${c.ok ? "OK" : "Missing"}: ${c.item}: ${c.detail}${c.fix ? `\n  Fix: ${c.fix}` : ""}`),
    "- `CLAUDE.md` was not touched.",
    ...(notice ? ["", `> ${notice}`] : []),
  ];
  const files = [merged.changed ? ".claude/settings.json" : undefined, createdLink ? LINK_FILE : undefined].filter(Boolean).map((f) => `\`${f}\``);
  const next = missing.length
    ? `Fix each item marked Missing (${missing.map((m) => m.item).join(", ")}), then run \`${CLI} hook install\` again.`
    : `${files.length ? `Commit ${files.join(" and ")} so the whole team is primed. ` : ""}Start a new Claude Code session in ${relative(cwd, root) ? `\`${root}\`` : "this repository"} (accept workspace trust): it is primed at startup, resume, clear and compact. Run \`${CLI} hook session-start\` to see the priming.`;
  print(json, { ok: missing.length === 0, settings: settingsFile, changed: merged.changed, linkCreated: createdLink, checks, updateNotice: notice }, md(missing.length ? "Hook installed; setup incomplete" : "Hook installed", lines, next));
  return missing.length ? 1 : 0;
}

export function runUninstall(cwd: string, json: boolean): number {
  const root = findGitRoot(cwd);
  const file = root ? join(root, ".claude", "settings.json") : undefined;
  if (!file || !existsSync(file)) {
    print(json, { ok: true, changed: false }, md("Hook not installed", ["- There is no `.claude/settings.json`; nothing to remove."], "None."));
    return 0;
  }
  const read = readSettings(file);
  const removed = "error" in read ? read : removeHook(read.settings);
  if ("error" in removed) {
    print(json, { ok: false, error: removed.error }, md("Hook not removed", [`- \`.claude/settings.json\`: ${removed.error}. Nothing was changed.`], "Remove the `idc365-decisions` SessionStart entry by hand."));
    return 1;
  }
  if (removed.changed) writeFileSync(file, JSON.stringify(removed.settings, null, 2) + "\n");
  print(json, { ok: true, changed: removed.changed }, md(removed.changed ? "Hook removed" : "Hook not installed", [removed.changed ? "- Removed the idc365-decisions SessionStart entry from `.claude/settings.json`; everything else is unchanged." : "- `.claude/settings.json` has no idc365-decisions entry; nothing changed.", `- \`${LINK_FILE}\` is kept (other commands use it).`], removed.changed ? "Commit `.claude/settings.json`." : "None."));
  return 0;
}

let version = "0.0.0";

async function readStdin(ms: number): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    let data = "";
    const done = () => {
      clearTimeout(t);
      process.stdin.pause();
      resolve(data);
    };
    const t = setTimeout(done, ms);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
  });
}

/** `hook session-start`: always prints valid hook JSON and exits 0, so a session never breaks. */
export async function runSessionStart(): Promise<void> {
  let cwd = process.cwd();
  try {
    const event = JSON.parse((await readStdin(1000)) || "{}") as { cwd?: unknown };
    if (typeof event.cwd === "string" && existsSync(event.cwd)) cwd = event.cwd;
  } catch {
    // No or invalid event: prime for the current folder.
  }
  let context: string;
  try {
    context = (await prime({ cwd, cacheDir: cacheDir(), version })).context;
  } catch (err) {
    context = `# IDC365 decision system\n\nThe idc365-decisions priming failed: ${(err as Error).message}. Tell the user; run \`${CLI} hook session-start\` in a terminal to see the problem.\n`;
  }
  process.stdout.write(hookOutput(context));
  process.exitCode = 0;
}

export function registerHookCommands(program: Command, pkgVersion: string): void {
  version = pkgVersion;
  const hook = program.command("hook").action(() => {
    process.stdout.write(md("Claude Code hook", HELP, `In a code repository, run \`${CLI} hook install\`.`));
  });
  hook.helpInformation = () => md("Claude Code hook", HELP, `In a code repository, run \`${CLI} hook install\`.`);
  hook
    .command("install")
    .option("--repository <org/repo>", "documentation repository for the link file")
    .option("--json")
    .action(async (o: { repository?: string; json?: boolean }) => {
      process.exitCode = await runInstall(process.cwd(), o);
    });
  hook
    .command("uninstall")
    .option("--json")
    .action((o: { json?: boolean }) => {
      process.exitCode = runUninstall(process.cwd(), !!o.json);
    });
  hook.command("session-start").action(runSessionStart);
}
