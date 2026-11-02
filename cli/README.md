# idc365-decisions CLI

`@idconnectdk/idc365-decisions` is the command-line interface to the
idc365-decisions documentation repository. It is built for AI agents: every
call prints markdown that tells the agent what to do next. Running it with no
arguments explains how to use it.

> Status: skeleton. A bare run prints a placeholder; there are no real
> commands yet.

The package is private. It is published to GitHub Packages under the
`idconnectdk` organisation and is never published to npmjs.org.

## Requirements

- Node.js 22.12 or later (`node --version`).
- Read access to the `idconnectdk/idc365-decisions` repository.
- A GitHub **personal access token (classic)** with the `read:packages`
  scope. GitHub Packages does not accept fine-grained tokens for npm.
  Create one at <https://github.com/settings/tokens>.

## One-time setup: `~/.npmrc`

npm must know that `@idconnectdk` packages come from GitHub Packages, and it
needs your token for that registry. Add these two lines to your **per-user**
`~/.npmrc` (not to a project's `.npmrc`, so the token never ends up in a
repository):

```ini
@idconnectdk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Then export the token in your shell profile (`~/.bashrc`, `~/.zshrc`, …):

```sh
export GITHUB_PACKAGES_TOKEN=ghp_your_classic_token
```

npm expands `${GITHUB_PACKAGES_TOKEN}` when it reads the file. You can also
paste the token directly in place of `${GITHUB_PACKAGES_TOKEN}`. If the
variable is not set, npm fails with `E401 ... authentication token not
provided`.

## Install

```sh
npm install -g @idconnectdk/idc365-decisions
idc365-decisions
```

The second command should print the CLI's markdown guide.

## Update

Every change to the CLI on `main` publishes a new version automatically. To
get the latest one:

```sh
npm install -g @idconnectdk/idc365-decisions@latest
idc365-decisions --version
```

## Documentation token

The CLI reads and writes the documentation repository through the GitHub API
with your own token, so pull requests carry your name. It reads the token
from the environment variable `IDC365_DECISIONS_TOKEN`.

1. Open <https://github.com/settings/personal-access-tokens/new>
   (**Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**).
2. **Resource owner:** `idconnectdk`.
3. **Repository access:** *Only select repositories* →
   `idconnectdk/idc365-decisions`.
4. **Repository permissions:**
   - **Contents:** Read and write
   - **Pull requests:** Read and write
   - (Metadata: Read-only is added automatically.)
5. Generate the token. If the organisation requires approval for
   fine-grained tokens, wait until an owner approves it.
6. Export it in your shell profile (`~/.bashrc`, `~/.zshrc`, …) and open a
   new shell:

   ```sh
   export IDC365_DECISIONS_TOKEN=github_pat_your_token
   ```

This is a different token from the classic `read:packages` token in
`~/.npmrc`, which is only for installing the CLI.

## Link a code repository

The CLI finds the documentation repository through
`.idc365-decisions.json` in the root of the code repository you work in. It
looks for the file from the current directory up to the git root:

```json
{ "repository": "idconnectdk/idc365-decisions" }
```

Commit the file. Check the setup with:

```sh
idc365-decisions setup
```

It reports a missing link file or token with the exact fix, and checks that
the token can access the repository (exit code `0` ready, `1` something is
missing).

## Write documentation

Agents write all documentation through the CLI. Every write goes to a work
branch and a pull request; **the user reviews and merges the PR in GitHub**.
The CLI never merges.

- **Guide per type:** `idc365-decisions adr` (also `proc`, `tech`, `code`)
  prints what the type is for, how to write it, its categories, the macro
  syntax and the verbs.
- **Create:** a new document with an ID the CLI allocates, on a new work
  branch `vX.Y.Z/<id>-<slug>` with its own PR:

  ```sh
  idc365-decisions adr create --version v1.0.1 --title "…" --description "…" \
    --intent "…" --when "…" --category data --body-file body.md
  ```

  `--version` decides the base branch: a patch of the released version goes
  to `main`, a planned release to its `release/vX.Y.Z` branch.
- **Several documents in one PR:** pass `--branch <work branch>` (printed by
  the first command) to `create` or `update`.
- **Update:** a correction in the same file, for example
  `idc365-decisions adr update ADR-0042 --version v1.0.1 --state deprecated`.
  A decision that changes is a new document that `supersedes` or `amends`
  the old one.
- **Read:** `idc365-decisions adr show ADR-0042` and
  `idc365-decisions adr list [--state accepted] [--category data]`, both
  with `--ref <branch or tag>` (default `main`).
- **Code documentation:** `idc365-decisions code create|update|show <path>`
  in a code repository; the path is relative to its git root, `src/_` is the
  folder `src`.
- **References** are macros in the body, expanded into links and relations
  when the CLI writes the file: `{{ADR:0042|<why>}}` or
  `{{ADR:0042|supersedes|<why>}}`. Prefixes: `ADR`, `PROC`, `TECH`, `REL`,
  `ATT`, `CODE` (`org/repo/path`), `JIRA` (`KEY-123`). `why` is required.

Every command prints markdown ending in `## Next action`; `--json` gives
machine-readable output.

## Validate a documentation tree

```sh
idc365-decisions validate [path] [--json]
```

Checks the documentation repository at `path` (default: the current
directory) on disk: the configuration in `config/`, frontmatter against the
schema of each type, file names and IDs, shadow documents, relations and
their inverses, links, unexpanded macros, attachments and the priming budget.

- Output is markdown with one section per file and a `## Next action`;
  `--json` prints `{ok, root, documents, findings}` where each finding has
  `file`, `rule`, `message` and `nextAction`.
- Exit code: `0` no findings, `1` findings, `2` the path is not a directory.

## Uninstall

```sh
npm uninstall -g @idconnectdk/idc365-decisions
```

## Development

The CLI lives in `cli/` of the idc365-decisions repository.

```sh
cd cli
npm ci             # install the locked dependencies
npm run build      # compile TypeScript from src/ to dist/
npm test           # compile and run the unit tests (node:test, no network)
node dist/index.js # run the CLI
```

Integration tests run against a real, disposable documentation repository
and are never part of `npm test` or CI. They open pull requests (and close
them again), create and delete work branches, and allocate IDs:

```sh
IDC365_TEST_REPO=<owner>/<repo> IDC365_DECISIONS_TOKEN=<token> npm run test:integration
```

Dependencies are pinned to exact versions (`cli/.npmrc` sets
`save-exact=true`) and locked in `package-lock.json`. Add a dependency only
when it is really needed.

## Releases

The GitHub Actions workflow `.github/workflows/cli-publish.yml` runs on every
push to `main` that changes `cli/` (or the workflow itself), and can also be
started by hand. It installs with `npm ci`, builds, smoke-tests the bare run
and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN`.
Pull requests that change `cli/` get the same install, build and smoke test
as a check, but never publish.

Versions are `<major>.<minor>.<run number>`: major and minor come from
`cli/package.json`, the patch is the workflow run number. To start a new
minor or major line, change `version` in `cli/package.json`.
