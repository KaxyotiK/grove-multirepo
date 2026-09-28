import { all, inFamily, type CommandSpec, type HelpArg } from "./commands/registry.ts";
import { GLOBAL_OPTION_DEFINITIONS } from "./commands/globals.ts";

export interface TopHelpDocument {
  title: string;
  usage: string;
  globalOptions: Array<{ option: string; description: string }>;
  commands: Array<{ path: string; summary: string }>;
  hint: string;
}

export interface FamilyHelpDocument {
  usage: string;
  family: string;
  title: string;
  commands: Array<{ path: string; summary: string; usage: string | null }>;
  hint: string;
}

export interface CommandHelpDocument {
  usage: string;
  command: string;
  summary: string;
  arguments: HelpArg[];
  options: HelpArg[];
  note: string | null;
  examples: string[];
}

export type HelpDocument = TopHelpDocument | FamilyHelpDocument | CommandHelpDocument;

export function topHelp(): TopHelpDocument {
  return {
    title: "grove — workspace-local multi-repo worktree manager",
    usage: "grove [global-options] <command> [args]",
    globalOptions: GLOBAL_OPTION_DEFINITIONS.map(({ help }) => ({ ...help })),
    commands: all().map((command) => ({ path: command.path, summary: command.summary })),
    hint: "Run `grove <command> --help` for one command's exact syntax and notes.",
  };
}

export function commandHelp(spec: CommandSpec): CommandHelpDocument {
  const args = spec.args ?? [];
  return {
    usage: `grove ${spec.usage ?? `${spec.path} [args]`}`,
    command: spec.path,
    summary: spec.summary,
    arguments: args.filter((arg) => !arg.name.startsWith("-")),
    options: args.filter((arg) => arg.name.startsWith("-")),
    note: spec.note ?? null,
    examples: spec.examples ?? [],
  };
}

export function familyHelp(family: string): FamilyHelpDocument {
  const commands = inFamily(family);
  return {
    usage: `grove ${family} <command> [args]`,
    family,
    title: `grove ${family} — ${commands.length} command${commands.length === 1 ? "" : "s"}`,
    commands: commands.map((command) => ({ path: command.path, summary: command.summary, usage: command.usage ?? null })),
    hint: `Run \`grove ${family} <command> --help\` for one command's exact syntax.`,
  };
}

function widthFor(columns: number): number {
  return Number.isFinite(columns) ? Math.max(40, Math.floor(columns)) : 100;
}

function wrap(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

function indentedProse(text: string, columns: number, indent = 2): string[] {
  const prefix = " ".repeat(indent);
  return wrap(text, Math.max(1, columns - indent)).map((line) => `${prefix}${line}`);
}

function syntaxTokens(text: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let token = "";
  for (const char of text.trim()) {
    if (char === "[") depth++;
    else if (char === "]") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (token) tokens.push(token);
      token = "";
    } else {
      token += char;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

function splitOversizedSyntax(token: string, width: number): string[] {
  if (token.length <= width) return [token];
  const words = token.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.flatMap((word) => splitOversizedSyntax(word, width));
  const alternatives = token.split(/(?<=\|)/);
  if (alternatives.length > 1) return alternatives.flatMap((part) => splitOversizedSyntax(part, width));
  const chunks: string[] = [];
  for (let offset = 0; offset < token.length; offset += width) chunks.push(token.slice(offset, offset + width));
  return chunks;
}

function hanging(text: string, columns: number, firstPrefix: string, continuationPrefix: string, syntax = false): string[] {
  const available = Math.max(1, columns - Math.max(firstPrefix.length, continuationPrefix.length));
  const grouped = syntax ? syntaxTokens(text) : text.trim().split(/\s+/).filter(Boolean);
  const words = syntax ? grouped.flatMap((word) => splitOversizedSyntax(word, available)) : grouped;
  if (words.length === 0) return [firstPrefix];

  const lines: string[] = [];
  let prefix = firstPrefix;
  let line = "";
  for (const word of words) {
    const width = Math.max(1, columns - prefix.length);
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(`${prefix}${line}`);
      prefix = continuationPrefix;
      line = word;
    }
  }
  lines.push(`${prefix}${line}`);
  return lines;
}

function usage(text: string, columns: number, firstPrefix = "  ", continuationPrefix = "    "): string[] {
  return hanging(text, columns, firstPrefix, continuationPrefix, true);
}

function alignedNameWidth(rows: Array<{ name: string; description: string }>, columns: number): number {
  const longest = Math.max(...rows.map((row) => row.name.length));
  return Math.min(longest, Math.max(1, columns - 2 - 2 - 16));
}

function aligned(rows: Array<{ name: string; description: string }>, columns: number, fixedNameWidth?: number): string[] {
  if (rows.length === 0) return [];
  const indent = 2;
  const gap = 2;
  const nameWidth = fixedNameWidth ?? alignedNameWidth(rows, columns);
  const descriptionIndent = indent + nameWidth + gap;
  const descriptionWidth = Math.max(1, columns - descriptionIndent);
  const lines: string[] = [];

  for (const row of rows) {
    const longestWord = Math.max(...row.description.trim().split(/\s+/).map((word) => word.length));
    const stacked = row.name.length > nameWidth || longestWord > descriptionWidth;
    const rowDescriptionIndent = stacked ? indent + gap : descriptionIndent;
    const description = wrap(row.description, Math.max(1, columns - rowDescriptionIndent));
    if (!stacked) {
      lines.push(`${" ".repeat(indent)}${row.name.padEnd(nameWidth)}${" ".repeat(gap)}${description[0]}`);
    } else {
      lines.push(`${" ".repeat(indent)}${row.name}`);
      lines.push(`${" ".repeat(rowDescriptionIndent)}${description[0]}`);
    }
    for (const continuation of description.slice(1)) {
      lines.push(`${" ".repeat(rowDescriptionIndent)}${continuation}`);
    }
  }
  return lines;
}

function section(lines: string[], heading: string, content: string[]): void {
  if (content.length === 0) return;
  if (lines.length > 0) lines.push("");
  lines.push(`${heading}:`, ...content);
}

function renderTop(document: TopHelpDocument, columns: number): string {
  const lines = hanging(document.title, columns, "", "  ");
  section(lines, "Usage", usage(document.usage, columns));
  section(lines, "Global options", aligned(document.globalOptions.map(({ option, description }) => ({ name: option, description })), columns));
  section(lines, "Commands", aligned(document.commands.map(({ path, summary }) => ({ name: path, description: summary })), columns));
  section(lines, "Hint", indentedProse(document.hint, columns));
  return lines.join("\n");
}

function renderFamily(document: FamilyHelpDocument, columns: number): string {
  const lines = hanging(document.title, columns, "", "  ");
  section(lines, "Usage", usage(document.usage, columns));

  const commands: string[] = [];
  const rows = document.commands.map((command) => ({ name: command.path, description: command.summary }));
  const nameWidth = alignedNameWidth(rows, columns);
  for (const command of document.commands) {
    commands.push(...aligned([{ name: command.path, description: command.summary }], columns, nameWidth));
    if (command.usage) commands.push(...usage(`grove ${command.usage}`, columns, "    Usage: ", "           "));
  }
  section(lines, "Commands", commands);
  section(lines, "Hint", indentedProse(document.hint, columns));
  return lines.join("\n");
}

function renderCommand(document: CommandHelpDocument, columns: number): string {
  const lines = hanging(`grove ${document.command} — ${document.summary}`, columns, "", "  ");
  section(lines, "Usage", usage(document.usage, columns));
  section(lines, "Arguments", aligned(document.arguments.map(({ name, desc }) => ({ name, description: desc })), columns));
  section(lines, "Options", aligned(document.options.map(({ name, desc }) => ({ name, description: desc })), columns));
  if (document.note) section(lines, "Notes", indentedProse(document.note, columns));
  section(lines, "Examples", document.examples.map((example) => `  ${example}`));
  return lines.join("\n");
}

/** Render one registry-derived help document for terminal reading. */
export function renderHumanHelp(document: HelpDocument, columns = 100): string {
  const width = widthFor(columns);
  if ("globalOptions" in document) return renderTop(document, width);
  if ("family" in document) return renderFamily(document, width);
  return renderCommand(document, width);
}
