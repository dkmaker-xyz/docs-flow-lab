import { GitHubClient, GitHubError } from "../github/index.js";
import { loadSetup, renderSetupProblems } from "../setup/setup.js";

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
  const { repository, token, linkFile } = result.setup;
  const client = new GitHubClient({ repository, token, fetch: fetchImpl });
  try {
    const repo = await client.request<{ full_name: string; permissions?: { push?: boolean } }>("GET", client.repoPath(""));
    if (repo.data.permissions && repo.data.permissions.push === false) {
      process.stdout.write(
        [
          "# Setup incomplete",
          "",
          `- Your GitHub account can read \`${repository}\` but has no write access to it.`,
          "  Fix: Ask an owner of the documentation repository for write access.",
          "",
          "## Next action",
          "",
          "Get write access, then run `idc365-decisions setup` again.",
          "",
        ].join("\n"),
      );
      return 1;
    }
  } catch (err) {
    if (!(err instanceof GitHubError)) throw err;
    process.stdout.write(renderSetupProblems([{ kind: "link-invalid", message: `Cannot access \`${repository}\`: ${err.message}.`, nextAction: err.nextAction }]));
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
