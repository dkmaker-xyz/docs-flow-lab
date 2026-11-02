#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { registerDocumentCommands } from "./commands/docs.js";
import { registerIndexCommands } from "./commands/index-cmd.js";
import { registerPostMergeCommand } from "./commands/postmerge-cmd.js";
import { registerReleaseCommands } from "./commands/release-cmd.js";
import { registerTechCheck } from "./commands/tech-check.js";
import { runSetupCheck } from "./commands/setup.js";
import { VALIDATE_HELP, runValidate } from "./commands/validate.js";
import { packageRoot } from "./engine/package-root.js";
import { placeholderMarkdown } from "./placeholder.js";

const pkg = JSON.parse(
  readFileSync(join(packageRoot(), "package.json"), "utf8"),
) as { version: string };

const program = new Command()
  .name("idc365-decisions")
  .version(pkg.version)
  .helpCommand(false)
  .enablePositionalOptions()
  .configureOutput({
    // Parse errors are reported as markdown too, with the next action.
    outputError: (message, write) =>
      write(
        [
          "# Error",
          "",
          message.replace(/^error: /, "").trim(),
          "",
          "## Next action",
          "",
          "Run `idc365-decisions` with no arguments to see what is available.",
          "",
        ].join("\n"),
      ),
  })
  .action(() => {
    process.stdout.write(placeholderMarkdown(pkg.version));
  });

// Agents get the same markdown guide for --help as for a bare run.
program.helpInformation = () => placeholderMarkdown(pkg.version);

const validate = program
  .command("validate")
  .argument("[path]", "documentation repository root")
  .option("--json", "machine-readable findings")
  .action((path: string | undefined, opts: { json?: boolean }) => {
    process.exitCode = runValidate(path, opts);
  });
validate.helpInformation = () => VALIDATE_HELP;

const setup = program.command("setup").action(async () => {
  process.exitCode = await runSetupCheck(process.cwd());
});
setup.helpInformation = () =>
  [
    "# idc365-decisions setup",
    "",
    "Checks that `.idc365-decisions.json` names the documentation repository, that",
    "`IDC365_DECISIONS_TOKEN` is set, and that the token can access the repository.",
    "Exit code: 0 ready, 1 something is missing.",
    "",
    "## Next action",
    "",
    "Run `idc365-decisions setup` in the code repository.",
    "",
  ].join("\n");

registerDocumentCommands(program);
registerIndexCommands(program);
registerPostMergeCommand(program);
registerReleaseCommands(program);
registerTechCheck(program);

await program.parseAsync(process.argv);
