/**
 * `grove completion <bash|zsh|fish>` (§8.2). The command list is generated from the registry —
 * never hand-listed — so completion cannot drift from the real surface (F2: completion ships with
 * US5, not Polish).
 */
import { GroveError } from "../errors.ts";
import { all, register, type CommandContext } from "./registry.ts";
import { parseCommand } from "./args.ts";
import { GLOBAL_OPTION_DEFINITIONS } from "./globals.ts";

/** Distinct first tokens (bare verbs + noun families) offered at the top level. */
function topWords(): string[] {
  const words = new Set<string>();
  for (const c of all()) words.add(c.path.split(" ")[0] as string);
  return [...words].sort();
}

/** Subcommands for each noun family, e.g. repo → [add, link, ls, …]. */
function subWords(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of all()) {
    const parts = c.path.split(" ");
    if (parts.length === 2) {
      const [head, sub] = parts as [string, string];
      map.set(head, [...(map.get(head) ?? []), sub]);
    }
  }
  return map;
}

function flagWords(): string[] {
  const flags = new Set(GLOBAL_OPTION_DEFINITIONS.flatMap(({ completion }) => completion));
  for (const command of all()) for (const arg of command.args ?? []) {
    const flag = arg.name.match(/^--[A-Za-z0-9-]+/)?.[0];
    if (flag) flags.add(flag);
  }
  return [...flags].sort();
}

function bash(): string {
  const top = topWords().join(" ");
  const flags = flagWords().join(" ");
  const subs = [...subWords().entries()].map(([head, subsList]) => `    ${head}) COMPREPLY=( $(compgen -W "${subsList.join(" ")}" -- "$cur") ); return;;`).join("\n");
  return `_grove() {
  local cur prev words cword
  _init_completion 2>/dev/null || { cur="\${COMP_WORDS[COMP_CWORD]}"; }
  if [[ "\${cur}" == --* ]]; then COMPREPLY=( $(compgen -W "${flags}" -- "\${cur}") ); return; fi
  if [ "\${COMP_CWORD}" -le 1 ]; then
    COMPREPLY=( $(compgen -W "${top}" -- "\${cur}") ); return
  fi
  case "\${COMP_WORDS[1]}" in
${subs}
  esac
}
complete -F _grove grove`;
}

function zsh(): string {
  return `#compdef grove
_grove() {
  local -a words
  words=(${topWords().join(" ")} ${flagWords().join(" ")})
  _describe 'command' words
}
_grove "$@"`;
}

function fish(): string {
  const lines: string[] = [`# grove-public-flags ${flagWords().join(" ")}`];
  for (const w of topWords()) lines.push(`complete -c grove -n '__fish_use_subcommand' -a '${w}'`);
  for (const [head, subs] of subWords()) for (const s of subs) lines.push(`complete -c grove -n '__fish_seen_subcommand_from ${head}' -a '${s}'`);
  for (const flag of flagWords()) lines.push(`complete -c grove -l '${flag.slice(2)}'`);
  return lines.join("\n");
}

function handler(ctx: CommandContext): number {
  const parsed = parseCommand(ctx);
  const shell = parsed.positionals[0];
  const script = shell === "bash" ? bash() : shell === "zsh" ? zsh() : shell === "fish" ? fish() : null;
  if (script === null) {
    throw new GroveError({ kind: "invalid-input", what: "completion requires a shell", why: "expected bash, zsh, or fish", remedy: "Use `grove completion <bash|zsh|fish>`.", detail: { shell } });
  }
  return ctx.emit.ok(script);
}

export function registerCompletion(): void {
  register({
    path: "completion",
    summary: "Generate a shell completion script.",
    usage: "completion <bash|zsh|fish>",
    args: [{ name: "<shell>", desc: "Shell to generate for: bash, zsh, or fish." }],
    note: "Source the printed script (or install it where your shell loads completions).",
    examples: [
      "grove completion zsh                                  # print the zsh completion script to stdout",
      "grove completion bash > ~/.grove-completion.bash      # save the bash script to source from your shell rc",
    ],
    handler,
    workspaceIndependent: true,
  });
}
