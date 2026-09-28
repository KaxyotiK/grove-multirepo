/**
 * Terminal-safety for untrusted, repo-borne strings (filenames, agent names/commands).
 *
 * A value that travels with a repository — a filename, a committed agent definition — is attacker-
 * controlled. Rendered raw to a terminal it can inject escape sequences (cursor moves, title
 * rewrites) or, via bidi overrides (U+202E "Trojan Source"), visually reorder the command a
 * teammate believes will run. `CONTROL_RE` covers the classes that matter for a terminal:
 *   - C0 controls + DEL (U+0000-001F, U+007F)
 *   - C1 controls (U+0080-009F) — includes CSI U+009B
 *   - bidi marks/embeddings/overrides/isolates (U+200E/200F, U+202A-202E, U+2066-2069)
 * `visibleControl` escapes exactly that class for display; short codepoints stay as the familiar
 * `\\xNN`, wider ones become `\\uNNNN`.
 */
export const CONTROL_RE =
  /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

export const containsControl = (s: string): boolean => CONTROL_RE.test(s);

export const visibleControl = (s: string): string =>
  s.replace(new RegExp(CONTROL_RE.source, "g"), (c) => {
    const code = c.codePointAt(0) ?? 0;
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u${code.toString(16).padStart(4, "0")}`;
  });
