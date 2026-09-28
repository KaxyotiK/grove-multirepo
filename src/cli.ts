// Grove CLI entry point (§8.1). Direct subcommand dispatch over the command registry.
// node:util.parseArgs is used inside command handlers; global options are parsed here.
import { createEmitter, flushOutput, type Emitter } from "./output.ts";
import { GroveError } from "./errors.ts";
import { resolve, familyNames, type GlobalOptions } from "./commands/registry.ts";
import { registerAll } from "./commands/index.ts";
import { EarlyExit } from "./commands/args.ts";
import { scanGlobals } from "./commands/globals.ts";
import { discoverWorkspace } from "./config/discovery.ts";
import { commandHelp, familyHelp, topHelp } from "./help.ts";
import { withOperation } from "./store/operation.ts";
import { enableProgress, progress } from "./progress.ts";
import { VERSION } from "./version.ts";

export async function run(argv: string[]): Promise<number> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
    process.stderr.write(`grove requires Node >=24; this process is Node ${process.versions.node}.\nInstall Node 24 LTS or newer, then retry.\n`);
    return 1;
  }
  const raw = argv.slice(2);
  // The preliminary pass is used ONLY to identify a command schema. The definitive pass receives
  // untouched argv so option/value adjacency and repeated-global order cannot be lost.
  const preliminary = scanGlobals(raw).scan;
  const preliminaryMatch = resolve(preliminary.rest);
  const preliminaryFamily = !preliminaryMatch && familyNames().includes(preliminary.rest[0] ?? "");
  const definitive = scanGlobals(raw, preliminaryMatch?.spec.options ?? (preliminaryFamily ? {} : undefined));
  const { globals } = definitive.scan;
  const rest = definitive.scan.rest;
  enableProgress(globals.progressJson);
  const emit = createEmitter(globals.json);

  // A tolerant scan continues after malformed globals so a later --json still controls the error
  // envelope. No help, version, discovery, or command work happens before this refusal.
  if (definitive.error) return emit.fail(definitive.error);
  if (definitive.scan.version) return emit.ok(VERSION);
  if (rest.length === 0) {
    return emit.help(topHelp());
  }

  const match = resolve(rest);
  if (!match) {
    // A bare noun family (`grove repo`) or one with a help flag (`grove repo --help`) is not a
    // command, but it is not an error either — list the family's subcommands (§8.2).
    const fam = rest[0] as string;
    if (familyNames().includes(fam)) {
      if (rest.length === 1 || definitive.scan.help) return emit.help(familyHelp(fam));
    }
    // Route through the error envelope so --json yields the standard {error:{…,exitCode:2}} (§9).
    return emit.fail(
      new GroveError({
        kind: "invalid-input",
        what: `Unknown command '${rest.join(" ")}'`,
        why: "no such command",
        remedy: "Run `grove --help` for the command list.",
        detail: { command: rest.join(" ") },
      }),
    );
  }

  if (definitive.scan.help) return emit.help(commandHelp(match.spec));

  const ctx = {
    globals,
    argv: rest.slice(match.consumed),
    emit,
    cwd: process.cwd(),
    spec: match.spec,
  };
  progress({ event: "command-start", command: match.spec.path });
  try {
    let exitCode: number;
    if (match.spec.mutates) {
      const workspaceRoot = discoverWorkspace({ cwd: ctx.cwd, workspace: globals.workspace });
      exitCode = await withOperation(workspaceRoot, match.spec.path, () => Promise.resolve(match.spec.handler(ctx)));
    } else {
      exitCode = await match.spec.handler(ctx);
    }
    progress({ event: "command-end", command: match.spec.path, exitCode });
    return exitCode;
  } catch (err) {
    // The CLI's schema-aware scan normally consumes these before dispatch. Keep the handler-level
    // signal as a defensive boundary for direct handler contexts without ever classifying it as an
    // internal failure.
    if (EarlyExit.is(err)) {
      const exitCode = err.which === "help" ? emit.help(commandHelp(match.spec)) : emit.ok(VERSION);
      progress({ event: "command-end", command: match.spec.path, exitCode });
      return exitCode;
    }
    // A node:util.parseArgs rejection is an invalid-argument condition (§9 exit 2), not an
    // internal failure (exit 1). Convert it to a clean GroveError naming the command.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
      const exitCode = emit.fail(
        new GroveError({
          kind: "invalid-input",
          what: `Invalid arguments for '${match.spec.path}'`,
          why: String((err as Error).message).split("\n")[0] ?? "could not parse the arguments",
          remedy: `Run \`grove ${match.spec.path} --help\`. To pass a value beginning with '-', use --opt=value.`,
          detail: { command: match.spec.path },
        }),
      );
      progress({ event: "command-end", command: match.spec.path, exitCode });
      return exitCode;
    }
    const exitCode = emit.fail(err);
    progress({ event: "command-end", command: match.spec.path, exitCode });
    return exitCode;
  }
}

registerAll();
const exitCode = await run(process.argv);
// A result can be larger than the pipe buffer, and pipe writes are asynchronous: exiting as soon as
// the command returns would truncate it (V3OUT-04). Deliver both streams in full, then exit
// explicitly so the process ends exactly as before, whatever else a command left pending.
await flushOutput();
process.exit(exitCode);
