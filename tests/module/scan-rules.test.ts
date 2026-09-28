/**
 * P2.6 / ledger G-9. `scripts/legacy-scan.sh` guards 007-crash-recovery-tests-SC-004: *"The
 * production bundle contains no fault-injection flag, environment read, or test hook."* The rule
 * named `GROVE_TEST_GIT_FAULT_CONFIG` **literally**, so it could only ever catch the single hook it
 * was written for — and `GROVE_TEST_MIGRATION_CRASH_AFTER` duly shipped in `dist/grove.mjs`.
 *
 * The instance is gone with P1.1, so a test asserting "no hook is present" would pass forever
 * without proving anything. These fixtures are the only evidence the *class* is now caught: a
 * novel hook name nobody has thought of yet must fail, and must fail under the current rule
 * specifically — the pre-P2.6 pattern is checked too, so a silent revert is visible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";

const SCAN = readFileSync("scripts/legacy-scan.sh", "utf8");

/** The extended-regex alternation the scan actually applies to src/ and dist/grove.mjs. */
function faultHookPattern(): RegExp {
  const line = /scan "no production Git fault hook" '\(([^']+)\)'/.exec(SCAN);
  assert.ok(line, "the production fault-hook rule is missing from legacy-scan.sh");
  return new RegExp(line[1]!);
}

const OLD_LITERAL_PATTERN = /(GROVE_TEST_GIT_FAULT_CONFIG|git fault proxy|sentinelTiming|exactGitArgs)/;

test("P2.6: a novel GROVE_TEST_* hook is caught by the current rule", () => {
  const pattern = faultHookPattern();
  const fixtures = [
    'const crash = process.env.GROVE_TEST_ANYTHING;',
    'if (process.env.GROVE_TEST_MIGRATION_CRASH_AFTER === step) throw new Error("x");',
    'const n = Number(process.env.GROVE_TEST_SOME_FUTURE_HOOK ?? 0);',
  ];
  for (const fixture of fixtures) {
    assert.ok(pattern.test(fixture), `the class rule missed a production hook: ${fixture}`);
  }
});

test("P2.6: negative control — the pre-P2.6 literal rule misses every one of them", () => {
  // If this ever fails, the fixtures stopped exercising the widening and the test above is
  // passing for the wrong reason.
  const fixtures = [
    'const crash = process.env.GROVE_TEST_ANYTHING;',
    'const n = Number(process.env.GROVE_TEST_SOME_FUTURE_HOOK ?? 0);',
  ];
  for (const fixture of fixtures) {
    assert.equal(OLD_LITERAL_PATTERN.test(fixture), false, `fixture does not exercise the widening: ${fixture}`);
  }
  // ...while still catching the one hook it was written for, so this is a widening, not a rewrite.
  assert.ok(faultHookPattern().test("process.env.GROVE_TEST_GIT_FAULT_CONFIG"));
});

test("P2.6: the rule is applied to the built artifact, not only to source", () => {
  // GROVE_TEST_MIGRATION_CRASH_AFTER reached dist/grove.mjs; scanning src alone would not have
  // caught it there.
  assert.match(SCAN, /PRODUCTION_ARTIFACTS\+=\(dist\/grove\.mjs\)/);
  assert.match(SCAN, /scan "no production Git fault hook".*PRODUCTION_ARTIFACTS/s);
});

test("P2.7: the control-byte rule's byte predicate accepts real text and rejects control bytes", () => {
  // ledger G-16. A raw NUL made a review record binary to git, so it had no diff for months.
  //
  // The predicate is extracted from the script and evaluated rather than restated here: the first
  // version of this rule was a `grep -lP` pattern that silently matched nothing on macOS, and a
  // test that restates the intended behaviour would have passed against it. This one can only pass
  // if the rule the scan actually runs has the right shape.
  assert.match(SCAN, /no control bytes in tracked text files/);
  const extracted = /return b\.some\(\(x\) => (.+?)\);/.exec(SCAN);
  assert.ok(extracted, "the control-byte rule is missing its byte predicate");
  const isControl = new Function("x", `return ${extracted[1]!};`) as (x: number) => boolean;

  for (const bad of [0x00, 0x01, 0x08, 0x0e, 0x1b, 0x1f, 0x7f]) {
    assert.ok(isControl(bad), `control byte not matched: 0x${bad.toString(16)}`);
  }
  for (const good of [0x09, 0x0a, 0x0d, 0x20, 0x41, 0x7e, 0xc2, 0xa7]) {
    assert.equal(isControl(good), false, `legitimate byte rejected: 0x${good.toString(16)}`);
  }
});

test("P2.7: the rule reads file bytes rather than delegating to grep -P", () => {
  // Why this is asserted at all: `grep -lP` passed on a real staged NUL file. BSD grep on macOS
  // has no -P, and where ugrep supplies it the wrapper passes -I, which skips binary files -- the
  // exact files this rule exists to find. A regression to a grep-based implementation would make
  // the gate silently unfailable again.
  // Assert against the rule's own command, not the file text: the comment above it explains the
  // grep failure by name, and matching that prose would be checking the wrong thing.
  const rule = /tracked_files=\$\(([\s\S]*?)\nif \[ -n "\$control_hits"/.exec(SCAN);
  assert.ok(rule, "the control-byte rule's command is missing");
  assert.doesNotMatch(rule[1]!, /grep/);
  assert.match(rule[1]!, /git ls-files -z[\s\S]*node -e/);
  // The enumeration's exit status must be checked: without it a failing `git ls-files` left
  // control_hits empty and the gate printed "ok:" and exited 0 — failing open.
  assert.match(rule[1]!, /\$\? -ne 0/);
});

test("paths: isSubpath is reflexive and isStrictSubpath is not", () => {
  // Three P0s in this repo shared one root cause: `isSubpath(p, p)` is true, so every guard of the
  // form "the recorded path is inside the workspace" also admitted the workspace itself. Pinning
  // both behaviours so the distinction cannot be quietly erased, and so the strict variant a future
  // destructive guard should reach for keeps existing.
  const source = readFileSync("src/paths/fs.ts", "utf8");
  assert.match(source, /For a destructive guard, do not use this/, "the reflexivity warning has been removed from isSubpath");
  assert.match(source, /export function isStrictSubpath/, "isStrictSubpath has been removed");
});

const FS_BOUNDARY = "src/paths/fs.ts";
const FORBIDDEN_FS_IMPORTS = new Set(["rmSync", "rm", "rmdirSync", "rmdir", "renameSync", "rename", "cpSync", "cp", "unlinkSync", "unlink"]);
const APPROVED_ATOMIC_FS_CALLS = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>([
  ["src/store/lock.ts", new Map([["renameSync", new Set(["acquire"])], ["unlinkSync", new Set(["acquire", "cleanupAgedStealMarker", "release"])]] )],
  ["src/store/manifest.ts", new Map([["renameSync", new Set(["writeManifest"])], ["unlinkSync", new Set(["writeManifest"])]] )],
  ["src/store/operation.ts", new Map([["renameSync", new Set(["persist"])]] )],
]);

/**
 * A structural and type-aware correctness gate, not a claim of runtime-language completeness.
 * It forbids unresolved dynamic imports and known builtin-loading forms. Within the three approved
 * atomic-store functions, arbitrary reflective indirection such as `Reflect.apply` still requires
 * human review; JavaScript can also manufacture module names or Git argv through runtime data the
 * AST cannot resolve. The runtime Git adapter and exported runner independently refuse direct worktree remove/move
 * argv after global options and inline alias configuration. Ambient Git config and arbitrary
 * runtime-generated commands still require review.
 * Keeping the filesystem allowlist keyed by file/function limits that residual review surface.
 */
function destructiveBoundaryViolations(path: string, file: ts.SourceFile, checker?: ts.TypeChecker): string[] {
  const violations: string[] = [];
  if (/@ts-(?:ignore|expect-error)\b/.test(file.text)) violations.push(`${path}: TypeScript error suppression is forbidden in production source`);
  const importedFs = new Map<string, string>();
  const importedChildProcess = new Map<string, string>();
  const containedTypeAliases = new Set(["ContainedPath", "ContainedParentPath"]);
  const constantStrings = new Map<string, ts.Expression>();

  const compact = (node: ts.Node): string => node.getText(file).replace(/\s+/g, "");
  const normalizeModule = (value: string): string => value.startsWith("node:") ? value.slice(5) : value;
  const moduleName = (node: ts.ImportDeclaration | ts.ExportDeclaration): string | null => node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) ? normalizeModule(node.moduleSpecifier.text) : null;
  const hasExport = (node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean => Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const staticText = (node: ts.Expression | undefined, seen = new Set<ts.Symbol>()): string | null => {
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) { const part = staticText(span.expression, seen); if (part === null) return null; value += part + span.literal.text; }
      return value;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticText(node.left, seen); const right = staticText(node.right, seen);
      return left === null || right === null ? null : left + right;
    }
    if (ts.isIdentifier(node)) {
      const declaration = constantStrings.get(node.text);
      if (declaration) return staticText(declaration, seen);
      const symbol = checker?.getSymbolAtLocation(node);
      if (symbol && !seen.has(symbol)) {
        seen.add(symbol);
        for (const candidate of symbol.declarations ?? []) if (ts.isVariableDeclaration(candidate) && candidate.initializer) {
          const value = staticText(candidate.initializer, seen); if (value !== null) return value;
        }
      }
    }
    return null;
  };

  const enclosingFunction = (node: ts.Node): string | null => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
      if (ts.isMethodDeclaration(current) && current.name && ts.isIdentifier(current.name)) return current.name.text;
      if ((ts.isFunctionExpression(current) || ts.isArrowFunction(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) return current.parent.name.text;
    }
    return null;
  };

  for (const statement of file.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && declaration.initializer) constantStrings.set(declaration.name.text, declaration.initializer);
  }

  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      const module = moduleName(statement);
      if (module === "fs" || module === "fs/promises" || module === "child_process") violations.push(`${path}: re-exports builtin ${module} capability`);
      continue;
    }
    if (!ts.isImportDeclaration(statement)) continue;
    const module = moduleName(statement);
    const clause = statement.importClause;
    if (!clause || !module) continue;
    if (module === "fs" || module === "fs/promises") {
      if (path !== FS_BOUNDARY && (clause.name || clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) violations.push(`${path}: default/namespace ${module} import bypasses the boundary`);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) {
          const imported = (specifier.propertyName ?? specifier.name).text;
          importedFs.set(specifier.name.text, imported);
          if (imported === "promises" && path !== FS_BOUNDARY) violations.push(`${path}: imports the unrestricted fs promises namespace`);
          const approved = APPROVED_ATOMIC_FS_CALLS.get(path)?.has(imported) === true;
          if (path !== FS_BOUNDARY && (module === "fs/promises" || FORBIDDEN_FS_IMPORTS.has(imported)) && !approved) violations.push(`${path}: imports destructive ${module} member ${imported}`);
        }
      }
    }
    if (module === "child_process") {
      if (clause.name || clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) violations.push(`${path}: default/namespace child_process import is not auditable`);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const specifier of clause.namedBindings.elements) importedChildProcess.set(specifier.name.text, (specifier.propertyName ?? specifier.name).text);
      }
    }
    if (module === "module" && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const specifier of clause.namedBindings.elements) {
      if ((specifier.propertyName ?? specifier.name).text === "createRequire") violations.push(`${path}: createRequire can bypass builtin import auditing`);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const specifier of clause.namedBindings.elements) {
      const imported = (specifier.propertyName ?? specifier.name).text;
      if (imported === "ContainedPath" || imported === "ContainedParentPath") containedTypeAliases.add(specifier.name.text);
    }
  }

  const approvedChildProcessCall = (imported: string, call: ts.CallExpression): boolean => {
    const command = staticText(call.arguments[0]);
    if (path === "src/git/adapter.ts" && imported === "spawn" && command === "git") return true;
    if (path === "src/git/native-recognition.ts" && imported === "spawnSync" && command === "git") return true;
    if (path === "src/store/lock.ts" && imported === "spawnSync" && command === "ps") return true;
    if (path === "src/commands/agent.ts" && imported === "spawn" && compact(call.arguments[0]!) === "definition.command") return true;
    return false;
  };

  const assertedOrigin = (node: ts.Expression, seen = new Set<ts.Symbol>()): boolean => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return true;
    if (ts.isParenthesizedExpression(node)) return assertedOrigin(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const symbol = checker?.getSymbolAtLocation(node);
      if (!symbol || seen.has(symbol)) return false;
      seen.add(symbol);
      return (symbol.declarations ?? []).some((declaration) => ts.isVariableDeclaration(declaration) && declaration.initializer ? assertedOrigin(declaration.initializer, seen) : false);
    }
    return false;
  };

  const containedParameter = (parameter: ts.Symbol, call: ts.CallExpression): boolean => {
    const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
    if (!checker || !declaration) return false;
    const text = checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, declaration));
    return /\bContained(?:Parent)?Path\b/.test(text);
  };

  const functionReturnsContained = (node: ts.Node): boolean => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (!ts.isFunctionLike(current)) continue;
      const explicit = current.type ? compact(current.type) : "";
      const signature = checker?.getSignatureFromDeclaration(current);
      const inferred = signature ? checker?.typeToString(checker.getReturnTypeOfSignature(signature)) ?? "" : "";
      return /\bContained(?:Parent)?Path\b/.test(`${explicit} ${inferred}`);
    }
    return false;
  };


  const inspect = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && importedChildProcess.has(node.text) && !ts.isImportSpecifier(node.parent)) {
      if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) violations.push(`${path}: child_process member escapes audited callee position`);
    }
    if (path !== "src/git/adapter.ts" && ts.isStringLiteralLike(node)) {
      if (/^(?:-c|--config-env=)?alias\./i.test(node.text)) violations.push(`${path}: inline Git alias bypasses typed adapter methods`);
      const siblings = node.parent.getChildren(file).flatMap(child => child.kind === ts.SyntaxKind.SyntaxList ? child.getChildren(file) : [child]);
      const index = siblings.indexOf(node);
      const next = siblings[index + 1]?.kind === ts.SyntaxKind.CommaToken ? siblings[index + 2] : siblings[index + 1];
      if (node.text === "worktree" && next && ts.isStringLiteralLike(next) && ["remove", "move"].includes(next.text)) violations.push(`${path}: raw Git worktree mutation bypasses typed adapter methods`);
    }
    if (path !== FS_BOUNDARY && ts.isReturnStatement(node) && node.expression && functionReturnsContained(node) && checker && (checker.getTypeAtLocation(node.expression).flags & ts.TypeFlags.Any) !== 0) violations.push(`${path}: any-typed return forges a containment brand`);

    if (path !== FS_BOUNDARY && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))) {
      const typeText = compact(node.type);
      const checkerText = checker ? checker.typeToString(checker.getTypeFromTypeNode(node.type)) : "";
      if (containedTypeAliases.has(typeText) || /\bContained(?:Parent)?Path\b/.test(checkerText)) violations.push(`${path}: forges a containment brand with a type assertion`);
      if (typeText === "any" && functionReturnsContained(node)) violations.push(`${path}: any assertion forges a function's containment-branded return`);
    }
    if (ts.isIdentifier(node) && node.text === "getBuiltinModule") violations.push(`${path}: getBuiltinModule can bypass builtin import auditing`);
    if (ts.isCallExpression(node)) {
      for (const typeArgument of node.typeArguments ?? []) {
        const typeText = compact(typeArgument);
        const checkerText = checker ? checker.typeToString(checker.getTypeFromTypeNode(typeArgument)) : "";
        if (containedTypeAliases.has(typeText) || /\bContained(?:Parent)?Path\b/.test(checkerText)) violations.push(`${path}: generic call can forge a containment brand`);
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const raw = staticText(node.arguments[0]);
        if (raw === null) violations.push(`${path}: non-literal dynamic import cannot be audited`);
        else if (["fs", "fs/promises", "child_process"].includes(normalizeModule(raw))) violations.push(`${path}: dynamically imports unrestricted builtin ${normalizeModule(raw)}`);
      }
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" && node.expression.name.text === "getBuiltinModule") violations.push(`${path}: process.getBuiltinModule bypasses builtin import auditing`);
      if (ts.isIdentifier(node.expression)) {
        const fsMember = importedFs.get(node.expression.text);
        if (path !== FS_BOUNDARY && fsMember && FORBIDDEN_FS_IMPORTS.has(fsMember)) {
          const approvedFunctions = APPROVED_ATOMIC_FS_CALLS.get(path)?.get(fsMember);
          if (!approvedFunctions?.has(enclosingFunction(node) ?? "")) violations.push(`${path}: destructive fs call is outside an approved atomic store function`);
        }
        const childMember = importedChildProcess.get(node.expression.text);
        if (childMember && !approvedChildProcessCall(childMember, node)) violations.push(`${path}: unaudited child_process ${childMember} call could launch rm/rmdir/mv`);
      }
      const signature = checker?.getResolvedSignature(node);
      if (signature) for (let index = 0; index < signature.parameters.length && index < node.arguments.length; index++) {
        const parameter = signature.parameters[index]!;
        if (!containedParameter(parameter, node)) continue;
        const argument = node.arguments[index]!;
        const type = checker!.getTypeAtLocation(argument);
        if ((type.flags & ts.TypeFlags.Any) !== 0) violations.push(`${path}: any-typed argument crosses a containment boundary`);
        if (assertedOrigin(argument)) violations.push(`${path}: assertion-produced argument crosses a containment boundary`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(file);

  if (path === FS_BOUNDARY) {
    interface FunctionInfo { parameters: ts.NodeArray<ts.ParameterDeclaration>; body: ts.Node; exported: boolean; calls: Set<string>; directlyDestructive: boolean }
    const functions = new Map<string, FunctionInfo>();
    const exportedNames = new Set<string>();
    let anonymousExport = 0;
    const markExportedName = (name: string): void => {
      exportedNames.add(name);
      if (FORBIDDEN_FS_IMPORTS.has(importedFs.get(name) ?? "")) violations.push(`${path}: export exposes destructive fs member ${name}`);
    };
    const markExportedExpression = (expression: ts.Expression): void => {
      if (ts.isIdentifier(expression)) { markExportedName(expression.text); return; }
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) { markExportedExpression(expression.expression); return; }
      if (ts.isObjectLiteralExpression(expression)) for (const property of expression.properties) {
        if (ts.isShorthandPropertyAssignment(property)) markExportedName(property.name.text);
        else if (ts.isPropertyAssignment(property)) markExportedExpression(property.initializer);
        else if (ts.isSpreadAssignment(property)) markExportedExpression(property.expression);
      }
      if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        const name = `default-export-${anonymousExport++}`;
        functions.set(name, { parameters: expression.parameters, body: expression.body, exported: true, calls: new Set(), directlyDestructive: false });
      }
    };
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.body) {
        const name = statement.name?.text ?? `default-export-${anonymousExport++}`;
        functions.set(name, { parameters: statement.parameters, body: statement.body, exported: hasExport(statement), calls: new Set(), directlyDestructive: false });
        if (hasExport(statement)) markExportedName(name);
      }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
          functions.set(declaration.name.text, { parameters: declaration.initializer.parameters, body: declaration.initializer.body, exported: hasExport(statement), calls: new Set(), directlyDestructive: false });
          if (hasExport(statement)) markExportedName(declaration.name.text);
        }
        if (hasExport(statement) && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) markExportedExpression(declaration.initializer);
      }
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const specifier of statement.exportClause.elements) {
        const local = (specifier.propertyName ?? specifier.name).text;
        markExportedName(local);
      }
      if (ts.isExportAssignment(statement)) markExportedExpression(statement.expression);
    }
    for (const name of exportedNames) { const info = functions.get(name); if (info) info.exported = true; }
    for (const info of functions.values()) {
      const inspectCalls = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const called = node.expression.text;
          info.calls.add(called);
          if (FORBIDDEN_FS_IMPORTS.has(importedFs.get(called) ?? "")) info.directlyDestructive = true;
        }
        ts.forEachChild(node, inspectCalls);
      };
      inspectCalls(info.body);
    }
    const reachesDestruction = (name: string, visiting = new Set<string>()): boolean => {
      const info = functions.get(name);
      if (!info || visiting.has(name)) return false;
      if (info.directlyDestructive) return true;
      visiting.add(name);
      const result = [...info.calls].some((called) => reachesDestruction(called, visiting));
      visiting.delete(name);
      return result;
    };
    for (const [name, info] of functions) {
      if (!info.exported || !reachesDestruction(name)) continue;
      for (let index = 0; index < info.parameters.length; index++) {
        if (name === "removeContainedSymbolicLink" && index === 1) continue; // validated single entry name, never a path
        if (!/^Contained(?:Parent)?Path$/.test(compact(info.parameters[index]!.type ?? info.parameters[index]!))) violations.push(`${path}: exported destructive helper ${name} parameter ${index + 1} accepts an unproved path`);
      }
    }
  }
  return violations;
}

function projectProgram(virtualSources = new Map<string, string>()): ts.Program {
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile("tsconfig.json", ts.sys.readFile).config, ts.sys, process.cwd());
  const host = ts.createCompilerHost(config.options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const absoluteVirtual = new Map([...virtualSources].map(([path, source]) => [join(process.cwd(), path), source]));
  host.fileExists = (path) => absoluteVirtual.has(path) || originalExists(path);
  host.readFile = (path) => absoluteVirtual.get(path) ?? originalRead(path);
  host.getSourceFile = (path, languageVersion) => {
    const source = host.readFile(path);
    return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true, ts.ScriptKind.TS);
  };
  return ts.createProgram({ rootNames: [...config.fileNames, ...absoluteVirtual.keys()], options: config.options, host });
}

test("paths: destructive directory calls stay behind the ContainedPath boundary", () => {
  const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
  const program = projectProgram();
  const checker = program.getTypeChecker();
  const violations = sourceFiles("src").flatMap((path) => {
    const file = program.getSourceFile(join(process.cwd(), path));
    assert.ok(file, `TypeScript program omitted ${path}`);
    return destructiveBoundaryViolations(path, file, checker);
  });
  assert.deepEqual(violations, []);
});

test("paths: negative controls catch every reviewed destructive-boundary bypass", () => {
  const fixtures = new Map<string, string>([
    ["unprefixed fs", 'import { rmSync } from "fs"; declare const path: string; rmSync(path, { recursive: true });'],
    ["aliased renameSync import", 'import { renameSync as relocate } from "node:fs"; declare const from: string, to: string; relocate(from, to);'],
    ["namespace destructuring", 'import * as fs from "node:fs"; declare const path: string; const { rmSync: nuke } = fs; nuke(path, { recursive: true });'],
    ["namespace bracket access", 'import * as fs from "node:fs"; declare const path: string; fs["rmSync"](path, { recursive: true });'],
    ["indirect call", 'import * as fs from "node:fs"; declare const path: string; (0, fs.rmSync)(path, { recursive: true });'],
    ["Function.call", 'import * as fs from "node:fs"; declare const path: string; fs.rmSync.call(fs, path, { recursive: true });'],
    ["fs promises module", 'import { rm as purge } from "node:fs/promises"; declare const path: string; await purge(path, { recursive: true });'],
    ["fs promises namespace", 'import * as promises from "node:fs/promises"; declare const path: string; await promises.rm(path, { recursive: true });'],
    ["fs promises member", 'import { promises } from "node:fs"; declare const path: string; await promises.rm(path, { recursive: true });'],
    ["async cp import", 'import { cp } from "node:fs"; await cp("from", "to", { recursive: true });'],
    ["createRequire", 'import { createRequire } from "node:module"; createRequire(import.meta.url)("node:fs").rmSync("x");'],
    ["getBuiltinModule", 'process.getBuiltinModule("node:fs").rmSync("x", { recursive: true });'],
    ["imported getBuiltinModule", 'import { getBuiltinModule } from "node:process"; getBuiltinModule("node:fs").rmSync("x", { recursive: true });'],
    ["globalThis getBuiltinModule", 'globalThis.process.getBuiltinModule("node:fs").rmSync("x", { recursive: true });'],
    ["unprefixed spawned rm", 'import { spawnSync } from "child_process"; spawnSync("rm", ["-rf", "x"]);'],
    ["aliased brand cast", 'import { removeContainedDirectory, type ContainedPath as CP } from "../paths/fs.ts"; declare const path: string; removeContainedDirectory(path as CP);'],
    ["brand cast through unknown", 'import { removeContainedDirectory, type ContainedPath } from "../paths/fs.ts"; declare const path: string; removeContainedDirectory(path as unknown as ContainedPath);'],
    ["any crosses helper", 'import { removeContainedDirectory } from "../paths/fs.ts"; declare const path: any; removeContainedDirectory(path);'],
    ["any branded return", 'import type { ContainedPath } from "../paths/fs.ts"; function forge(): ContainedPath { return "raw" as any; }'],
    ["generic branded cast", 'import type { ContainedPath } from "../paths/fs.ts"; declare function cast<T>(): T; const forged = cast<ContainedPath>();'],
    ["ts-ignore helper call", 'import { removeContainedDirectory } from "../paths/fs.ts"; // @ts-ignore\nremoveContainedDirectory("raw");'],
    ["ts-expect-error helper call", 'import { removeContainedDirectory } from "../paths/fs.ts"; // @ts-expect-error\nremoveContainedDirectory("raw");'],
    ["raw Git worktree mutation", 'import { Git, createGitRunner } from "../git/adapter.ts"; declare const raw: string; new Git(createGitRunner()).tryRun(".", ["worktree", "remove", "--force", "--", raw]);'],
    ["raw Git tryRunBytes mutation", 'import { Git, createGitRunner } from "../git/adapter.ts"; declare const raw: string; new Git(createGitRunner()).tryRunBytes(".", ["worktree", "remove", "--", raw]);'],
    ["raw runner runBytes mutation", 'declare const runner: { runBytes(cwd: string, args: string[]): unknown }; runner.runBytes(".", ["worktree", "move", "--", "/a", "/b"]);'],
    ["raw Git mutation after global options", 'import { Git, createGitRunner } from "../git/adapter.ts"; new Git(createGitRunner()).tryRun(".", ["-C", ".", "-c", "k=v", "worktree", "remove", "--", "/raw"]);'],
    ["named re-export", 'export { rmSync } from "node:fs";'],
    ["star re-export", 'export * from "node:fs";'],
    ["dynamic fs import", 'await import("fs");'],
    ["template module", 'const prefix = "f"; await import(`${prefix}s`);'],
    ["variable module", 'const builtin = "node:fs"; await import(builtin);'],
    ["unresolved module", 'declare const builtin: string; await import(builtin);'],
    ["URL string cannot hide code", 'const marker = "https://example.test"; import { rmSync as purge } from "node:fs"; purge(marker);'],
    ["comment opener string cannot hide code", 'const marker = "/*"; import { renameSync as relocate } from "node:fs"; relocate(marker, marker);'],
  ]);
  const virtual = new Map([...fixtures].map(([name, source], index) => [`src/fixtures/gate-${index}.ts`, source]));
  const program = projectProgram(virtual);
  const checker = program.getTypeChecker();
  [...fixtures.keys()].forEach((name, index) => {
    const path = `src/fixtures/gate-${index}.ts`;
    const file = program.getSourceFile(join(process.cwd(), path));
    assert.ok(file, `TypeScript program omitted ${name}`);
    assert.notDeepEqual(destructiveBoundaryViolations(path, file, checker), [], name);
  });

  const rawExport = `${readFileSync(FS_BOUNDARY, "utf8")}\nexport function purge(path: string): void { rmSync(path, { recursive: true }); }\n`;
  const exportProgram = projectProgram(new Map([[FS_BOUNDARY, rawExport]]));
  const exportFile = exportProgram.getSourceFile(join(process.cwd(), FS_BOUNDARY));
  assert.ok(exportFile);
  assert.notDeepEqual(destructiveBoundaryViolations(FS_BOUNDARY, exportFile, exportProgram.getTypeChecker()), [], "raw-string destructive export");

  const boundary = readFileSync(FS_BOUNDARY, "utf8");
  const boundaryBypasses = [
    ["local export specifier", 'function localPurge(path: string): void { rmSync(path, { recursive: true }); } export { localPurge as purge };'],
    ["default export", 'function defaultPurge(path: string): void { rmSync(path, { recursive: true }); } export default defaultPurge;'],
    ["anonymous default export", 'export default function(path: string): void { rmSync(path, { recursive: true }); }'],
    ["exported object", 'function objectPurge(path: string): void { rmSync(path, { recursive: true }); } export const destructive = { objectPurge };'],
    ["default exported object", 'function defaultObjectPurge(path: string): void { rmSync(path, { recursive: true }); } export default { purge: defaultObjectPurge };'],
    ["exported imported member", 'export const destructive = { rmSync };'],
    ["unproved second parameter", 'function rawDestination(from: ContainedPath, to: string): void { renameSync(from, to); } export { rawDestination };'],
  ] as const;
  for (const [name, addition] of boundaryBypasses) {
    const program = projectProgram(new Map([[FS_BOUNDARY, `${boundary}\n${addition}\n`]]));
    const source = program.getSourceFile(join(process.cwd(), FS_BOUNDARY));
    assert.ok(source);
    assert.notDeepEqual(destructiveBoundaryViolations(FS_BOUNDARY, source, program.getTypeChecker()), [], name);
  }
});

test("reconcile: destructive replay re-proves and records point-of-use containment failures", () => {
  const file = ts.createSourceFile("src/commands/reconcile.ts", readFileSync("src/commands/reconcile.ts", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const branches = new Map<string, ts.Statement>();
  const calls = (root: ts.Node): ts.CallExpression[] => {
    const found: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) found.push(node); ts.forEachChild(node, visit); };
    visit(root); return found.sort((left, right) => left.getStart(file) - right.getStart(file));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isPropertyAccessExpression(node.expression.left) && node.expression.left.name.text === "kind" && ts.isStringLiteral(node.expression.right)) branches.set(node.expression.right.text, node.thenStatement);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const callName = (call: ts.CallExpression): string | null => ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
  const moveCalls = calls(branches.get("directory-move")!);
  const mkdirIndex = moveCalls.findIndex((call) => callName(call) === "mkdirSync");
  const moveIndex = moveCalls.findIndex((call, index) => index > mkdirIndex && callName(call) === "moveContainedDirectory");
  assert.ok(mkdirIndex >= 0 && moveIndex > mkdirIndex, "directory move no longer re-proves after parent creation");
  const moveCall = moveCalls[moveIndex]!;
  assert.deepEqual(moveCall.arguments.map((argument) => ts.isCallExpression(argument) ? callName(argument) : null), ["containedPath", "containedPath"]);

  const removeBranch = branches.get("directory-remove")!;
  const findRemoveTry = (node: ts.Node): ts.TryStatement | null => {
    if (ts.isTryStatement(node) && calls(node.tryBlock).some((call) => callName(call) === "removeContainedDirectory")) return node;
    let found: ts.TryStatement | null = null;
    ts.forEachChild(node, (child) => { found ??= findRemoveTry(child); });
    return found;
  };
  const removeTry = findRemoveTry(removeBranch);
  assert.ok(removeTry?.catchClause, "directory removal is no longer caught after pending persistence");
  assert.ok(calls(removeBranch).some((call) => callName(call) === "ensurePending"));
  assert.ok(calls(removeTry.catchClause).some((call) => callName(call) === "recordStepFailure"));

  for (const kind of ["directory-move", "directory-merge", "directory-remove"] as const) {
    const branchCalls = calls(branches.get(kind)!);
    const proofPositions = branchCalls.filter((call) => callName(call) === "assertDestructiveMutationPath").map((call) => call.getStart(file));
    const pendingPositions = branchCalls.filter((call) => callName(call) === "ensurePending").map((call) => call.getStart(file));
    assert.ok(proofPositions.length >= 2, `${kind} no longer proves protected ownership in preflight and at point of use`);
    assert.ok(pendingPositions.some((pending) => proofPositions.some((proof) => proof < pending) && proofPositions.some((proof) => proof > pending)), `${kind} ownership proofs no longer bracket pending persistence`);
  }
});

for (const [name, source] of [
  ["child_process alias", 'import { spawnSync } from "node:child_process"; const run = spawnSync; run("rm", ["-rf", "x"]);'],
  ["child_process call", 'import { spawnSync } from "node:child_process"; spawnSync.call(null, "rm", ["-rf", "x"]);'],
  ["global option", 'declare const g: any; g.run(".", ["--no-optional-locks", "worktree", "remove", "x"]);'],
  ["config alias", 'declare const g: any; g.run(".", ["-c", "alias.zap=worktree remove --force", "zap"]);'],
  ["spread argv", 'declare const g: any, base: string[]; g.run(".", [...base, "worktree", "move", "x", "y"]);'],
  ["pushed argv", 'declare const g: any; const argv: string[] = []; argv.push("worktree", "remove", "x"); g.run(".", argv);'],
  ["any return", 'import type { ContainedPath } from "../paths/fs.ts"; function forge(raw:string): ContainedPath { return JSON.parse(raw); }'],
] as const) test(`round5: static gate catches ${name}`, () => {
  const path = 'src/fixtures/round5.ts';
  const program = projectProgram(new Map([[path, source]]));
  const file = program.getSourceFile(join(process.cwd(), path))!;
  assert.notDeepEqual(destructiveBoundaryViolations(path, file, program.getTypeChecker()), []);
});
