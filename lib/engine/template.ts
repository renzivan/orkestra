export interface TemplateContext {
  system: string;
  input: string;
  projects: string[];
}

/**
 * Turn a model command template into an argv array, filling placeholders.
 * No shell is involved — the result is passed directly to Bun.spawn.
 *
 * Placeholders:
 *   {system}          -> replaced (in place) with the system text
 *   {input}           -> replaced (in place) with the input text
 *   {projects}        -> a standalone token; expands to one token per path
 *   {projects:--flag} -> a standalone token; expands to `--flag <path>` per path
 */
export function buildArgv(command: string, ctx: TemplateContext): string[] {
  const tokens = tokenize(command);
  const argv: string[] = [];
  for (const token of tokens) {
    if (token === "{projects}") {
      argv.push(...ctx.projects);
      continue;
    }
    const flagMatch = token.match(/^\{projects:(.+)\}$/);
    if (flagMatch) {
      const flag = flagMatch[1];
      for (const p of ctx.projects) argv.push(flag, p);
      continue;
    }
    argv.push(substitute(token, ctx));
  }
  return argv;
}

function substitute(token: string, ctx: TemplateContext): string {
  return token
    .split("{system}")
    .join(ctx.system)
    .split("{input}")
    .join(ctx.input);
}

/** Split on whitespace, honoring single and double quotes. */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === " " || ch === "\t" || ch === "\n") {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}
