"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Flat links above and below the collapsible Agents section.
const TOP = [
  { href: "/tasks", label: "Tasks" },
  { href: "/flows", label: "Flows" },
];
const BOTTOM = [
  { href: "/skills", label: "Skills" },
  { href: "/projects", label: "Projects" },
  { href: "/settings", label: "Settings" },
];

interface AgentLink {
  id: number;
  name: string;
}

export function Nav({ agents }: { agents: AgentLink[] }) {
  const path = usePathname();
  const isActive = (href: string) =>
    path === href || path.startsWith(href + "/");

  return (
    <nav className="nav">
      {TOP.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={isActive(l.href) ? "active" : ""}
        >
          {l.label}
        </Link>
      ))}

      <AgentsSection agents={agents} path={path} />

      {BOTTOM.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={isActive(l.href) ? "active" : ""}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

function AgentsSection({ agents, path }: { agents: AgentLink[]; path: string }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="nav-group">
      <div className="nav-group-head">
        <button
          type="button"
          className="nav-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`nav-caret ${open ? "open" : ""}`} aria-hidden>
            ▸
          </span>
          Agents
        </button>
        <Link href="/agents/new" className="nav-add" aria-label="New agent">
          +
        </Link>
      </div>

      {open && (
        <div className="nav-sub">
          {agents.length === 0 ? (
            <span className="nav-empty">No agents yet.</span>
          ) : (
            agents.map((a) => (
              <Link
                key={a.id}
                href={`/agents/${a.id}`}
                className={path === `/agents/${a.id}` ? "active" : ""}
              >
                {a.name}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
