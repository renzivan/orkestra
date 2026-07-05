import type { Usage } from "@/lib/types";

// The one number people read first: every token the run touched, summed across
// the four kinds.
function total(u: Usage): number {
  return (
    u.input_tokens +
    u.output_tokens +
    u.cache_creation_tokens +
    u.cache_read_tokens
  );
}

// A token-usage readout: a labelled total ("Tokens: N", or "<label> tokens: N")
// over a per-kind breakdown. Renders nothing when usage is null — the adapter
// reported none — so callers can drop it in unconditionally. Pass compact to
// show only the total line (used on the dense task-board card). A plain function
// component (no client hooks), usable from Server Components and the client run
// view alike.
export function UsageBadge({
  usage,
  label,
  compact,
}: {
  usage: Usage | null;
  label?: string;
  compact?: boolean;
}) {
  if (!usage) return null;
  const n = (v: number) => v.toLocaleString();
  const heading = label ? `${label} tokens` : "Tokens";
  return (
    <div
      className="usage muted mono"
      title="tokens — input · output · cache write · cache read"
    >
      <span className="usage-total">
        {heading}: {n(total(usage))}
      </span>
      {!compact && (
        <span className="usage-break">
          {n(usage.input_tokens)} in · {n(usage.output_tokens)} out ·{" "}
          {n(usage.cache_creation_tokens)} cache write ·{" "}
          {n(usage.cache_read_tokens)} cache read
        </span>
      )}
    </div>
  );
}
