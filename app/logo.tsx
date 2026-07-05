/**
 * Orkestra mark — a coordinator node wired to three agent nodes (hub-and-spoke).
 * It is the product in one glyph: one orchestrator dispatching work to parallel
 * agents. Single-colour via currentColor so it inherits the brand green and
 * scales down to a 16px favicon; the filled centre stays legible when tiny.
 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden
    >
      {/* spokes from the coordinator out to each agent */}
      <path d="M12 12 12 4.5M12 12 5.6 17.5M12 12 18.4 17.5" />
      {/* agent nodes */}
      <circle cx="12" cy="4" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="5.2" cy="18" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="18.8" cy="18" r="2.1" fill="currentColor" stroke="none" />
      {/* coordinator (larger, ringed so it reads as the hub) */}
      <circle cx="12" cy="12" r="3.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
