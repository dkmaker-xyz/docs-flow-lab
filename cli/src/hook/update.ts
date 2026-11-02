import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Daily, cached check for a newer CLI version on the package registry
 * (spec 8.1). The CLI never updates itself: the notice tells the agent to ask
 * the user and gives the exact command. Package and registry are
 * configurable (IDC365_DECISIONS_PACKAGE, IDC365_DECISIONS_REGISTRY).
 */

export const DEFAULT_PACKAGE = "@idconnectdk/idc365-decisions";
export const DEFAULT_REGISTRY = "https://npm.pkg.github.com";
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface PackageTarget {
  name: string;
  registry: string;
}

export function packageTarget(env: NodeJS.ProcessEnv = process.env): PackageTarget {
  return { name: env.IDC365_DECISIONS_PACKAGE?.trim() || DEFAULT_PACKAGE, registry: env.IDC365_DECISIONS_REGISTRY?.trim() || DEFAULT_REGISTRY };
}

/** npm version `X.Y.Z` (an optional pre-release or build suffix is ignored for the comparison). */
export function parseNpmVersion(text: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

function newerThan(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export type ViewResult = { ok: true; version: string } | { ok: false; error: string };
/** Reads the latest published version; injected in tests. */
export type Viewer = (target: PackageTarget, timeoutMs: number) => Promise<ViewResult>;

/** `npm view <pkg> version --registry <r>`: uses the user's own npm login (~/.npmrc), the same one `npm install -g` needs. */
export const npmView: Viewer = (target, timeoutMs) =>
  new Promise((resolve) => {
    const scope = target.name.startsWith("@") ? target.name.split("/")[0] : undefined;
    const args = ["view", target.name, "version", "--registry", target.registry, ...(scope ? [`--${scope}:registry=${target.registry}`] : [])];
    execFile(process.platform === "win32" ? "npm.cmd" : "npm", args, { timeout: timeoutMs, encoding: "utf8", shell: process.platform === "win32" }, (err, stdout, stderr) => {
      const version = String(stdout ?? "").trim().split(/\s+/).pop() ?? "";
      if (!err && parseNpmVersion(version)) return resolve({ ok: true, version });
      const code = /E401|ENEEDAUTH|401/.test(String(stderr)) ? "not logged in to the registry (401)" : /E403|403/.test(String(stderr)) ? "no access to the package (403)" : /E404|404/.test(String(stderr)) ? "package not found (404)" : err?.killed ? "timed out" : (String(stderr).trim().split("\n").find((l) => /ERR!/.test(l)) ?? err?.message ?? "no version returned").replace(/^npm (ERR!|error) ?/, "");
      resolve({ ok: false, error: code });
    });
  });

interface UpdateCache {
  checkedAt: string;
  package: string;
  registry: string;
  result: ViewResult;
}

export interface UpdateStatus {
  current: string;
  latest?: string;
  newer: boolean;
  error?: string;
  /** From the cache (checked less than a day ago). */
  cached: boolean;
  checkedAt: string;
  command: string;
}

export function installCommand(target: PackageTarget, version?: string): string {
  return `npm install -g ${target.name}${version ? `@${version}` : "@latest"}`;
}

/** Checks at most once a day per package and registry; never throws. */
export async function checkForUpdate(current: string, o: { dir: string; env?: NodeJS.ProcessEnv; now?: Date; view?: Viewer; timeoutMs?: number; force?: boolean }): Promise<UpdateStatus> {
  const target = packageTarget(o.env);
  const now = o.now ?? new Date();
  const file = join(o.dir, "update-check.json");
  let cache: UpdateCache | undefined;
  try {
    cache = JSON.parse(readFileSync(file, "utf8")) as UpdateCache;
  } catch {
    cache = undefined;
  }
  const fresh = !o.force && cache && cache.package === target.name && cache.registry === target.registry && now.getTime() - Date.parse(cache.checkedAt) < CHECK_INTERVAL_MS && now.getTime() >= Date.parse(cache.checkedAt);
  let result: ViewResult;
  let checkedAt: string;
  if (fresh) {
    result = cache!.result;
    checkedAt = cache!.checkedAt;
  } else {
    result = await (o.view ?? npmView)(target, o.timeoutMs ?? 5000);
    checkedAt = now.toISOString();
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ checkedAt, package: target.name, registry: target.registry, result } satisfies UpdateCache));
    } catch {
      // A read-only cache only means the check runs again next time.
    }
  }
  const cur = parseNpmVersion(current);
  const latest = result.ok ? parseNpmVersion(result.version) : undefined;
  const newer = !!cur && !!latest && newerThan(latest, cur);
  return { current, latest: result.ok ? result.version : undefined, newer, error: result.ok ? undefined : result.error, cached: !!fresh, checkedAt, command: installCommand(target, result.ok ? result.version : undefined) };
}

/** The notice for the agent, or undefined when the CLI is current. */
export function updateNotice(s: UpdateStatus): string | undefined {
  if (!s.newer) return undefined;
  return `A newer idc365-decisions CLI is available: ${s.latest} (installed ${s.current}). Ask the user for permission before updating; do not update on your own. The command is \`${s.command}\`.`;
}
