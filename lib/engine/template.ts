export interface TemplateContext {
  system: string;
  input: string;
  projects: string[];
  model: string;
  effort: string;
  /** CLI session id to resume; empty drops the flag (a fresh conversation). */
  resume: string;
  /** Emit the bare permission-skip flag (no value) when true. */
  skip: boolean;
}

/**
 * Turn a model command template into an argv array, filling placeholders.
 * No shell is involved — the result is passed directly to Bun.spawn.
 *
 * Scalar placeholders (substituted in place within a token):
 *   {system} {input} {model} {effort}
 *
 * Flag placeholders (a token of the form {name:--flag}):
 *   {projects:--flag} -> per path, emit `--flag <path>`
 *   {model:--flag} / {effort:--flag} / {resume:--flag} -> emit `--flag <value>`,
 *   or nothing if the value is empty (so an unset effort/resume drops the flag).
 *   {skip:--flag} -> emit the bare `--flag` (no value) when skip is true, else
 *   nothing.
 *   {projects} alone -> one token per path.
 */
export function buildArgv(command: string, ctx: TemplateContext): string[] {
  const tokens = tokenize(command);
  const argv: string[] = [];
  for (const token of tokens) {
    if (token === "{projects}") {
      argv.push(...ctx.projects);
      continue;
    }
    const flagMatch = token.match(
      /^\{(projects|model|effort|resume|skip):(.+)\}$/,
    );
    if (flagMatch) {
      const [, name, flag] = flagMatch;
      if (name === "projects") {
        for (const p of ctx.projects) argv.push(flag, p);
      } else if (name === "skip") {
        if (ctx.skip) argv.push(flag); // bare boolean flag, no value
      } else {
        const value = ctx[name as "model" | "effort" | "resume"];
        if (value !== "") argv.push(flag, value);
      }
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
    .join(ctx.input)
    .split("{model}")
    .join(ctx.model)
    .split("{effort}")
    .join(ctx.effort);
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
