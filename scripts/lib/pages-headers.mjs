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
 * - every matching rule applies, in the order of the file; a header set by two
 *   matching rules gets both values joined with ", " — which is why
 *   Cache-Control must never be set by `/*` and by a narrower rule at the same
 *   time;
 * - `! Name` (with the space) removes a header an earlier matching rule set;
 *   inside one rule the removals come before the headers it sets;
 * - ONE rule per pattern. Pages keys the rules by their pattern
 *   (workers-sdk, workers-shared/utils/configuration/constructConfiguration.ts,
 *   constructHeaders: `rules[rule.path] = configuredRule`), so a pattern
 *   written twice keeps only its LAST rule, at the place of the first. A
 *   second `/_next/static/*` that only removes headers silently drops the
 *   year of cache the first one set. parseHeadersFile reports it and returns
 *   the rules as Pages keeps them;
 * - at most 100 rules, lines of at most 2,000 characters.
 */

export const PAGES_MAX_RULES = 100;
export const PAGES_MAX_LINE = 2_000;

/**
 * @returns {{
 *   rules: {pattern: string, set: [string, string][], detach: string[]}[],
 *   problems: string[],
 * }}
 * `rules` are the rules Pages ends up with: one per pattern, the last one
 * written, in the position of the first.
 */
export function parseHeadersFile(text) {
  const written = [];
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
      current = { pattern, line: index + 1, set: [], detach: [] };
      written.push(current);
      return;
    }
    if (!current) {
      problems.push(`${where}: a header before any URL pattern`);
      return;
    }
    const body = line.trim();
    if (body.startsWith("! ")) {
      current.detach.push(body.slice(2).trim().toLowerCase());
      return;
    }
    const colon = body.indexOf(":");
    if (colon <= 0) {
      problems.push(`${where}: "${body}" is not "Name: value"`);
      return;
    }
    current.set.push([body.slice(0, colon).trim(), body.slice(colon + 1).trim()]);
  });
  if (written.length > PAGES_MAX_RULES) {
    problems.push(`${written.length} rules (Pages allows ${PAGES_MAX_RULES})`);
  }

  // Keyed by pattern, as Pages does: the last rule wins, the first keeps its place.
  const byPattern = new Map();
  for (const rule of written) {
    const earlier = byPattern.get(rule.pattern);
    if (earlier) {
      problems.push(
        `"${rule.pattern}" is written on line ${earlier.line} and again on line ${rule.line}: ` +
          `Pages keeps only the rule on line ${rule.line}, and drops ${describe(earlier)}`,
      );
    }
    byPattern.set(rule.pattern, rule);
  }
  const rules = [...byPattern.values()].map(({ pattern, set, detach }) => ({ pattern, set, detach }));
  return { rules, problems };
}

function describe(rule) {
  const parts = [...rule.set.map(([name]) => name), ...rule.detach.map((name) => `! ${name}`)];
  return parts.length > 0 ? parts.join(", ") : "nothing";
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

/**
 * The headers Pages sends for a path, names lower-cased. `base` is what the
 * response carries before `_headers` (Pages' own Cache-Control on a static
 * file): the first rule that sets a header replaces it, a later rule that
 * sets it again appends, and a removal takes out whatever is there so far —
 * the order of pages-shared/asset-server/handler.ts, attachHeaders.
 */
export function headersFor(rules, path, base = {}) {
  const out = new Map(Object.entries(base).map(([name, value]) => [name.toLowerCase(), value]));
  const setByFile = new Set();
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    for (const name of rule.detach) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      if (setByFile.has(key) && out.has(key)) out.set(key, `${out.get(key)}, ${value}`);
      else out.set(key, value);
      setByFile.add(key);
    }
  }
  return Object.fromEntries(out);
}
