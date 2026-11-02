import { GitHubClient, GitHubError } from "../github/index.js";
import { loadSetup, renderSetupProblems } from "../setup/setup.js";

export type AccessResult = { ok: true } | { ok: false; message: string; nextAction: string };

/** Whether the token can read and write the documentation repository. */
export async function checkAccess(repository: string, token: string, fetchImpl?: typeof fetch): Promise<AccessResult> {
  const client = new GitHubClient({ repository, token, fetch: fetchImpl });
  try {
    const repo = await client.request<{ full_name: string; permissions?: { push?: boolean } }>("GET", client.repoPath(""));
    if (repo.data.permissions && repo.data.permissions.push === false) {
      return { ok: false, message: `Your GitHub account can read \`${repository}\` but has no write access to it.`, nextAction: "Ask an owner of the documentation repository for write access." };
    }
    return { ok: true };
  } catch (err) {
    if (!(err instanceof GitHubError)) throw err;
    return { ok: false, message: `Cannot access \`${repository}\`: ${err.message}.`, nextAction: err.nextAction };
  }
}

/**
 * `idc365-decisions setup`: checks the link file, the token and that the token
 * can read the documentation repository. Returns the exit code.
 */
export async function runSetupCheck(cwd: string, fetchImpl?: typeof fetch): Promise<number> {
  const result = loadSetup(cwd);
  if (!result.ok) {
    process.stdout.write(renderSetupProblems(result.problems));
    return 1;
  }
  const { repository, linkFile } = result.setup;
  const access = await checkAccess(result.setup.repository, result.setup.token, fetchImpl);
  if (!access.ok) {
    process.stdout.write(renderSetupProblems([{ kind: "link-invalid", message: access.message, nextAction: access.nextAction }]));
    return 1;
  }
  process.stdout.write(
    [
      "# Setup complete",
      "",
      `- Documentation repository: \`${repository}\` (from \`${linkFile}\`)`,
      "- Token: set and has access",
      "",
      "## Next action",
      "",
      "None. Continue with your task.",
      "",
    ].join("\n"),
  );
  return 0;
}
