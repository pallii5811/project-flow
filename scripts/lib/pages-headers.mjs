/**
 * Cloudflare Pages `_headers`, read the way Pages reads it, so the local
 * server (scripts/serve-static.mjs), the export check and the tests all judge
 * the same file by the same rules.
 *
 * The format (developers.cloudflare.com/pages/configuration/headers):
 *
 *   /path/:placeholder/*
 *     Header-Name: value
 *     ! Header-To-Remove
 *
 * - a line that starts without a space is a URL pattern; the indented lines
 *   under it are its headers; `#` starts a comment;
 * - `*` (a splat, one per pattern) matches anything, slashes included;
 *   `:name` matches one path segment;
 * - every matching rule applies; a header set by two matching rules gets both
 *   values joined with ", " — which is why Cache-Control must never be set by
 *   `/*` and by a narrower rule at the same time;
 * - `! Name` removes a header another matching rule set;
 * - at most 100 rules, lines of at most 2,000 characters.
 */

export const PAGES_MAX_RULES = 100;
export const PAGES_MAX_LINE = 2_000;

/** @returns {{ rules: {pattern: string, set: [string, string][], detach: string[]}[], problems: string[] }} */
export function parseHeadersFile(text) {
  const rules = [];
  const problems = [];
  let current = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const where = `line ${index + 1}`;
    if (line.length > PAGES_MAX_LINE) {
      problems.push(`${where} is ${line.length} characters (Pages allows ${PAGES_MAX_LINE})`);
    }
    if (line.trim() === "" || line.trim().startsWith("#")) return;
    if (!/^\s/.test(line)) {
      const pattern = line.trim();
      if ((pattern.match(/\*/g) ?? []).length > 1) {
        problems.push(`${where}: "${pattern}" has more than one splat`);
      }
      current = { pattern, set: [], detach: [] };
      rules.push(current);
      return;
    }
    if (!current) {
      problems.push(`${where}: a header before any URL pattern`);
      return;
    }
    const body = line.trim();
    if (body.startsWith("!")) {
      current.detach.push(body.slice(1).trim().toLowerCase());
      return;
    }
    const colon = body.indexOf(":");
    if (colon <= 0) {
      problems.push(`${where}: "${body}" is not "Name: value"`);
      return;
    }
    current.set.push([body.slice(0, colon).trim(), body.slice(colon + 1).trim()]);
  });
  if (rules.length > PAGES_MAX_RULES) {
    problems.push(`${rules.length} rules (Pages allows ${PAGES_MAX_RULES})`);
  }
  return { rules, problems };
}

function escapeRegExp(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern as an anchored regular expression over the path. */
export function patternToRegExp(pattern) {
  // A full URL pattern ("https://host/path") is matched on its path only.
  const path = pattern.replace(/^https?:\/\/[^/]+/, "");
  let source = "";
  for (const part of path.split(/(\*|:[A-Za-z_][A-Za-z0-9_]*)/)) {
    if (part === "*") source += ".*";
    else if (part.startsWith(":") && part.length > 1) source += "[^/]+";
    else source += escapeRegExp(part);
  }
  return new RegExp(`^${source}$`);
}

/** The headers Pages sends for a path, names lower-cased. */
export function headersFor(rules, path) {
  const out = new Map();
  const detached = new Set();
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      out.set(key, out.has(key) ? `${out.get(key)}, ${value}` : value);
    }
    for (const name of rule.detach) detached.add(name);
  }
  for (const name of detached) out.delete(name);
  return Object.fromEntries(out);
}
