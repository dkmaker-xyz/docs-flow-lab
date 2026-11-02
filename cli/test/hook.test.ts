import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { runInstall, runUninstall } from "../src/commands/hook-cmd.js";
import { charCount, PRIMING_FIXED_TEXT } from "../src/engine/index.js";
import { packageRoot } from "../src/engine/package-root.js";
import { composePriming, hookOutput, prime } from "../src/hook/prime.js";
import { HOOK_HANDLER, isOurHandler, mergeHook, removeHook } from "../src/hook/settings.js";
import { checkForUpdate, npmView, updateNotice, type Viewer } from "../src/hook/update.js";
import { FakeRepo } from "./docs/fakerepo.js";
import { REPO } from "./github/mock.js";

const temp = mkdtempSync(join(tmpdir(), "idc365-hook-"));
after(() => rmSync(temp, { recursive: true, force: true }));
const uniq = (p: string) => join(temp, `${p}-${Math.random().toString(36).slice(2)}`);
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });

function ok<T>(r: T | { error: string }): T {
  assert.ok(!(r && typeof r === "object" && "error" in r), JSON.stringify(r));
  return r as T;
}

describe("settings merge and uninstall", () => {
  test("adds one exec-form handler without a matcher to empty settings", () => {
    const r = ok(mergeHook({}));
    assert.equal(r.changed, true);
    assert.deepEqual(r.settings, { hooks: { SessionStart: [{ hooks: [HOOK_HANDLER] }] } });
    assert.equal("matcher" in (r.settings.hooks as { SessionStart: object[] }).SessionStart[0]!, false);
  });
  test("is idempotent", () => {
    const once = ok(mergeHook({})).settings;
    const twice = ok(mergeHook(once));
    assert.equal(twice.changed, false);
    assert.deepEqual(twice.settings, once);
  });
  test("keeps every other setting, event and SessionStart hook", () => {
    const settings = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "check.sh" }] }],
        SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }],
      },
      env: { A: "1" },
    };
    const before = JSON.stringify(settings);
    const r = ok(mergeHook(settings));
    assert.equal(JSON.stringify(settings), before, "input not mutated");
    assert.deepEqual(r.settings, { ...settings, hooks: { ...settings.hooks, SessionStart: [...settings.hooks.SessionStart, { hooks: [HOOK_HANDLER] }] } });
  });
  test("an old copy (shell form, a matcher, another timeout) is replaced by the one entry", () => {
    const settings = {
      hooks: {
        SessionStart: [
          { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }, { type: "command", command: "idc365-decisions  hook session-start" }] },
          { hooks: [{ type: "command", command: "idc365-decisions", args: ["hook", "session-start"], timeout: 60 }, { type: "command", command: "other" }] },
        ],
      },
    };
    const r = ok(mergeHook(settings));
    assert.deepEqual(r.settings.hooks, { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }, { hooks: [HOOK_HANDLER, { type: "command", command: "other" }] }] });
    assert.equal(isOurHandler({ type: "command", command: "idc365-decisions", args: ["hook", "other"] }), false);
  });
  test("refuses a hooks section of the wrong shape", () => {
    assert.deepEqual(mergeHook({ hooks: { SessionStart: {} } }), { error: "`hooks.SessionStart` is not an array" });
    assert.deepEqual(mergeHook({ hooks: [] }), { error: "`hooks` is not an object" });
  });
  test("uninstall removes only its entry and the containers it leaves empty", () => {
    const other = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    const installed = ok(mergeHook({ model: "x", hooks: { SessionStart: [other], Stop: [] } })).settings;
    assert.deepEqual(ok(removeHook(installed)), { settings: { model: "x", hooks: { SessionStart: [other], Stop: [] } }, changed: true });
    assert.deepEqual(ok(removeHook(ok(mergeHook({ model: "x" })).settings)), { settings: { model: "x" }, changed: true });
    assert.deepEqual(ok(removeHook({ model: "x" })), { settings: { model: "x" }, changed: false });
  });
});

// A code repository with a mapped release branch, a feature branch from it and an unrelated branch.
function codeRepo(link = true): string {
  const root = uniq("code");
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "remote", "add", "origin", "https://github.com/acme/app.git");
  if (link) writeFileSync(join(root, ".idc365-decisions.json"), JSON.stringify({ repository: REPO }));
  writeFileSync(join(root, "a.txt"), "a");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "main");
  git(root, "checkout", "-q", "-b", "release/2.0");
  writeFileSync(join(root, "b.txt"), "b");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "release");
  git(root, "checkout", "-q", "-b", "feature/x");
  git(root, "checkout", "-q", "main");
  git(root, "checkout", "-q", "-b", "other/y");
  writeFileSync(join(root, "c.txt"), "c");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "other");
  git(root, "checkout", "-q", "release/2.0");
  return root;
}

const REL = "---\nid: REL-0001\ntitle: Release v2.0.0\ndescription: d\nintent: i\nwhen: w\nstate: accepted\nversion: v2.0.0\nphase: development\ndocs_branch: release/v2.0.0\ncode:\n  - repo: acme/app\n    branch: release/2.0\n---\n";
const doc = (id: string, body: string) => `---\nid: ${id}\ntitle: Overview ${id}\ndescription: d\nintent: i\nwhen: w\nstate: accepted\ncategory: architecture\nfeatured: true\n---\n${body}\n`;

function docsRepo(featured: Record<string, string> = { "ADR-0001": "The repository has two apps: web and api." }, budget = 8000) {
  const r = new FakeRepo();
  r.seed("main", { "README.md": "x", "docs/release/0001-release-v2-0-0.md": REL, "config/priming.yaml": "priming_budget: 8000\n" });
  const files: Record<string, string> = { "config/priming.yaml": `priming_budget: ${budget}\n` };
  for (const [id, body] of Object.entries(featured)) files[`docs/adr/${id.slice(4)}-overview.md`] = doc(id, body);
  const head = r.seed("release/v2.0.0", files, "main");
  const documents = Object.keys(featured).map((id) => ({ id, type: "ADR", path: `docs/adr/${id.slice(4)}-overview.md`, title: `Overview ${id}`, state: "accepted", featured: true, commit: { sha: head, date: "2026-11-01" } }));
  documents.push({ id: "ADR-0099", type: "ADR", path: "docs/adr/0099-x.md", title: "Not featured", state: "accepted", featured: false, commit: { sha: head, date: "2026-11-01" } });
  r.seed("meta/index", { "release__v2.0.0.json": JSON.stringify({ schema: 1, branch: "release/v2.0.0", sourceSha: head, generatedAt: "x", base: null, documents, skipped: [] }) });
  return r;
}

const noUpdate: Viewer = async () => ({ ok: true, version: "0.1.0" });
const offline = (async () => {
  throw new TypeError("fetch failed");
}) as unknown as typeof fetch;
const env = (token?: string) => ({ PATH: process.env.PATH, HOME: process.env.HOME, ...(token ? { IDC365_DECISIONS_TOKEN: token } : {}) });

describe("priming (hook session-start)", () => {
  test("online: release, documentation branch, commands and the featured body; cache written", async () => {
    const r = docsRepo();
    const cwd = codeRepo();
    const cache = uniq("cache");
    const p = await prime({ cwd, env: env("t"), cacheDir: cache, version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.equal(p.mode, "online");
    assert.equal(p.docsBranch, "release/v2.0.0");
    assert.match(p.context, /documentation repository `acme\/docs`/);
    assert.match(p.context, /Release: v2\.0\.0 \(REL-0001, phase development\), the branch is mapped/);
    assert.match(p.context, /Documentation branch: `release\/v2\.0\.0`: read with `--ref release\/v2\.0\.0`/);
    assert.match(p.context, /idc365-decisions tech check/);
    assert.match(p.context, /## Featured: ADR-0001 Overview ADR-0001\n\nThe repository has two apps: web and api\./);
    assert.doesNotMatch(p.context, /Not featured|Primed from the cache/);
    assert.ok(charCount(p.context) <= 8000);
    assert.ok(existsSync(join(cache, "priming", "acme", "docs", "release__v2.0.0.json")));
    const out = JSON.parse(hookOutput(p.context));
    assert.deepEqual(Object.keys(out.hookSpecificOutput), ["hookEventName", "additionalContext"]);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  });
  test("a feature branch inherits the release; an unrelated branch is orphaned with the map command", async () => {
    const r = docsRepo();
    const cwd = codeRepo();
    git(cwd, "checkout", "-q", "feature/x");
    const inherited = await prime({ cwd, env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.match(inherited.context, /inherited from the mapped branch `release\/2\.0` \(git merge-base\)/);
    git(cwd, "checkout", "-q", "other/y");
    const orphan = await prime({ cwd, env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.equal(orphan.docsBranch, "main");
    assert.match(orphan.context, /Release: none\. This branch is orphaned/);
    assert.match(orphan.context, /release map --repo acme\/app --branch other\/y <REL-ID>/);
  });
  test("a cached body is reused while the document is unchanged", async () => {
    const r = docsRepo();
    const cwd = codeRepo();
    const cache = uniq("cache");
    await prime({ cwd, env: env("t"), cacheDir: cache, version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    const reads = () => r.mock.calls.filter((c) => c.path.endsWith("/contents/docs/adr/0001-overview.md")).length;
    const n = reads();
    await prime({ cwd, env: env("t"), cacheDir: cache, version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.equal(reads(), n);
  });
  test("featured documents over the budget are left out by name; the result stays within it", async () => {
    const r = docsRepo({ "ADR-0001": "a".repeat(500), "ADR-0002": "b".repeat(3000), "ADR-0003": "c".repeat(200) }, 2500);
    const p = await prime({ cwd: codeRepo(), env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.match(p.context, /## Featured: ADR-0001/);
    assert.match(p.context, /## Featured: ADR-0003/);
    assert.doesNotMatch(p.context, /## Featured: ADR-0002/);
    assert.match(p.context, /left out to stay within the budget of 2500 characters: ADR-0002/);
    assert.ok(charCount(p.context) <= 2500 + 200);
    assert.ok(charCount(composePriming("a/b", [], [], [], 20000)) <= 10000);
  });
  test("offline: primes from the cache with a stale warning and the reason", async () => {
    const r = docsRepo();
    const cwd = codeRepo();
    const cache = uniq("cache");
    await prime({ cwd, env: env("t"), cacheDir: cache, version: "0.1.0", fetch: r.mock.fetch, view: noUpdate, now: new Date("2026-11-03T08:00:00Z") });
    const p = await prime({ cwd, env: env("t"), cacheDir: cache, version: "0.1.0", fetch: offline, view: noUpdate });
    assert.equal(p.mode, "cache");
    assert.match(p.context, /Primed from the cache of 2026-11-03 08:00 UTC because the documentation repository could not be read: could not reach GitHub/);
    assert.match(p.context, /may be out of date/);
    assert.match(p.context, /Release: v2\.0\.0/);
    assert.match(p.context, /The repository has two apps/);
  });
  test("missing token: the cache, and what is missing", async () => {
    const r = docsRepo();
    const cwd = codeRepo();
    const cache = uniq("cache");
    await prime({ cwd, env: env("t"), cacheDir: cache, version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    const p = await prime({ cwd, env: env(), cacheDir: cache, version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.equal(p.mode, "cache");
    assert.match(p.context, /`IDC365_DECISIONS_TOKEN` is not set\. Fix: Create a fine-grained personal access token/);
    assert.match(p.context, /The repository has two apps/);
  });
  test("a rejected token is named; no cache at all still primes and says so", async () => {
    const reject = (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const p = await prime({ cwd: codeRepo(), env: env("bad"), cacheDir: uniq("cache"), version: "0.1.0", fetch: reject, view: noUpdate });
    assert.equal(p.mode, "none");
    assert.match(p.context, /No cached priming exists .* the token in `IDC365_DECISIONS_TOKEN` was rejected \(401\)/);
    assert.match(p.context, /## Most important commands/);
  });
  test("a slow documentation repository stops at the deadline and falls back", async () => {
    const slow = (async () => new Promise(() => {})) as unknown as typeof fetch;
    const started = Date.now();
    const p = await prime({ cwd: codeRepo(), env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", fetch: slow, view: noUpdate, deadlineMs: 300 });
    assert.ok(Date.now() - started < 2000);
    assert.match(p.context, /did not answer within 0\.3 s/);
  });
  test("a repository without the link file gets a short notice", async () => {
    const p = await prime({ cwd: codeRepo(false), env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", view: noUpdate });
    assert.equal(p.mode, "none");
    assert.match(p.context, /not linked to a documentation repository/);
  });
  test("the fixed text the validator counts covers a realistic head", async () => {
    const r = docsRepo({});
    const p = await prime({ cwd: codeRepo(), env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", fetch: r.mock.fetch, view: noUpdate });
    assert.ok(charCount(p.context) <= charCount(PRIMING_FIXED_TEXT), `${charCount(p.context)} > ${charCount(PRIMING_FIXED_TEXT)}`);
  });
  test("an update notice reaches the priming", async () => {
    const r = docsRepo();
    const p = await prime({ cwd: codeRepo(), env: env("t"), cacheDir: uniq("cache"), version: "0.1.0", fetch: r.mock.fetch, view: async () => ({ ok: true, version: "0.1.7" }) });
    assert.match(p.context, /> A newer idc365-decisions CLI is available: 0\.1\.7 \(installed 0\.1\.0\)\. Ask the user for permission before updating/);
  });
});

describe("update notice", () => {
  test("newer version: notice with the exact command; checked at most once a day", async () => {
    const dir = uniq("upd");
    let calls = 0;
    const view: Viewer = async (t) => {
      calls++;
      return { ok: true, version: t.name === "@acme/cli" ? "1.3.10" : "9.9.9" };
    };
    const e = { IDC365_DECISIONS_PACKAGE: "@acme/cli", IDC365_DECISIONS_REGISTRY: "http://registry.test" };
    const day0 = new Date("2026-11-03T08:00:00Z");
    const s = await checkForUpdate("1.3.9", { dir, env: e, now: day0, view });
    assert.deepEqual([s.newer, s.latest, s.cached, s.command], [true, "1.3.10", false, "npm install -g @acme/cli@1.3.10"]);
    assert.match(updateNotice(s)!, /Ask the user for permission before updating; do not update on your own\. The command is `npm install -g @acme\/cli@1\.3\.10`\./);
    const again = await checkForUpdate("1.3.9", { dir, env: e, now: new Date("2026-11-03T20:00:00Z"), view });
    assert.deepEqual([again.cached, calls], [true, 1]);
    await checkForUpdate("1.3.9", { dir, env: e, now: new Date("2026-11-04T09:00:00Z"), view });
    assert.equal(calls, 2);
    await checkForUpdate("1.3.9", { dir, env: { ...e, IDC365_DECISIONS_PACKAGE: "@other/cli" }, now: new Date("2026-11-04T10:00:00Z"), view });
    assert.equal(calls, 3, "another package is checked anew");
  });
  test("same or older version, or a failed check: no notice", async () => {
    assert.equal(updateNotice(await checkForUpdate("1.3.10", { dir: uniq("u"), view: async () => ({ ok: true, version: "1.3.10" }) })), undefined);
    assert.equal(updateNotice(await checkForUpdate("1.4.0", { dir: uniq("u"), view: async () => ({ ok: true, version: "1.3.10" }) })), undefined);
    const failed = await checkForUpdate("1.0.0", { dir: uniq("u"), view: async () => ({ ok: false, error: "not logged in to the registry (401)" }) });
    assert.deepEqual([failed.newer, failed.error], [false, "not logged in to the registry (401)"]);
  });
  test("npm view against a mocked registry", async () => {
    const server = createServer((req, res) => {
      if (!/test-cli/.test(decodeURIComponent(req.url ?? ""))) {
        res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: "@acme/test-cli", "dist-tags": { latest: "0.1.42" }, versions: { "0.1.41": { name: "@acme/test-cli", version: "0.1.41" }, "0.1.42": { name: "@acme/test-cli", version: "0.1.42" } }, time: {} }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.deepEqual(await npmView({ name: "@acme/test-cli", registry }, 20000), { ok: true, version: "0.1.42" });
      const missing = await npmView({ name: "@acme/missing", registry }, 20000);
      assert.ok(!missing.ok && /404/.test(missing.error));
    } finally {
      server.close();
    }
  });
});

function capture<T>(fn: () => Promise<T> | T): Promise<{ value: T; out: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  return Promise.resolve()
    .then(fn)
    .then((value) => ({ value, out }))
    .finally(() => {
      process.stdout.write = original;
    });
}

describe("hook install and uninstall", () => {
  const ghOk = (async () => new Response(JSON.stringify({ full_name: REPO, permissions: { push: true } }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  test("merges the hook, creates the link file, checks token, access and npm; idempotent; never writes CLAUDE.md", async () => {
    const root = codeRepo(false);
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { deny: ["Read(.env)"] } }));
    const run = () => capture(() => runInstall(join(root), { repository: REPO, env: { ...env("t"), IDC365_DECISIONS_CACHE: uniq("c") }, fetch: ghOk, view: noUpdate, interactive: false, version: "0.1.0" }));
    const first = await run();
    assert.equal(first.value, 0, first.out);
    assert.match(first.out, /OK: Hook: merged into/);
    assert.match(first.out, /OK: Link file: created `\.idc365-decisions\.json` naming `acme\/docs`/);
    assert.match(first.out, /OK: Token: .* can read and write `acme\/docs`/);
    assert.match(first.out, /OK: npm: .*\(latest 0\.1\.0\)/);
    assert.doesNotMatch(first.out, /newer idc365-decisions CLI/);
    assert.match(first.out, /Commit `\.claude\/settings\.json` and `\.idc365-decisions\.json`/);
    const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(settings, { permissions: { deny: ["Read(.env)"] }, hooks: { SessionStart: [{ hooks: [HOOK_HANDLER] }] } });
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".idc365-decisions.json"), "utf8")), { repository: REPO });
    const second = await run();
    assert.match(second.out, /OK: Hook: already in/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")), settings);
    assert.equal(readdirSync(root).includes("CLAUDE.md"), false);
  });
  test("reports what is missing: link file, token, npm access; exit 1", async () => {
    const root = codeRepo(false);
    const { value, out } = await capture(() => runInstall(root, { env: env(), view: async () => ({ ok: false, error: "not logged in to the registry (401)" }), interactive: false }));
    assert.equal(value, 1);
    assert.match(out, /Missing: Link file: `\.idc365-decisions\.json` is missing/);
    assert.match(out, /Missing: Token: `IDC365_DECISIONS_TOKEN` is not set/);
    assert.match(out, /Missing: npm: .* not logged in to the registry \(401\)\n  Fix: Log in to the registry/);
    assert.ok(existsSync(join(root, ".claude", "settings.json")), "the hook is installed anyway");
  });
  test("the link file comes from the prompt when interactive", async () => {
    const root = codeRepo(false);
    await capture(() => runInstall(root, { env: env("t"), fetch: ghOk, view: noUpdate, interactive: true, prompt: async () => "acme/docs" }));
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".idc365-decisions.json"), "utf8")), { repository: REPO });
  });
  test("invalid settings JSON is not overwritten", async () => {
    const root = codeRepo();
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude", "settings.json"), "{ not json");
    const { value, out } = await capture(() => runInstall(root, { env: env("t"), fetch: ghOk, view: noUpdate, interactive: false }));
    assert.equal(value, 1);
    assert.match(out, /cannot be read: it is not valid JSON/);
    assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), "{ not json");
  });
  test("uninstall removes only its entry", async () => {
    const root = codeRepo();
    mkdirSync(join(root, ".claude"));
    const other = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [other, { hooks: [HOOK_HANDLER] }] } }));
    const { out } = await capture(() => runUninstall(root, false));
    assert.match(out, /# Hook removed/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8")), { hooks: { SessionStart: [other] } });
    assert.ok(existsSync(join(root, ".idc365-decisions.json")));
    assert.match((await capture(() => runUninstall(root, false))).out, /# Hook not installed/);
  });
});

describe("hook session-start binary", () => {
  test("prints valid hook JSON and exits 0 even with no setup", () => {
    const root = codeRepo(false);
    const cache = uniq("c");
    mkdirSync(cache);
    writeFileSync(join(cache, "update-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), package: "@idconnectdk/idc365-decisions", registry: "https://npm.pkg.github.com", result: { ok: false, error: "x" } }));
    const out = execFileSync(process.execPath, [join(packageRoot(), "dist", "index.js"), "hook", "session-start"], { cwd: root, input: JSON.stringify({ hook_event_name: "SessionStart", source: "clear", cwd: root }), env: { PATH: process.env.PATH, HOME: process.env.HOME, IDC365_DECISIONS_CACHE: cache }, encoding: "utf8" });
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /not linked/);
  });
});
