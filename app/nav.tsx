"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  id: number;
  name: string;
}
export interface NavGroup {
  title: string;
  base: string;
  items: NavItem[];
}

export function Nav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const isActive = (href: string) =>
    path === href || path.startsWith(href + "/");

  return (
    <nav className="nav">
      <div className="nav-group">
        <div className="nav-group-head">
          <span className="nav-group-label">Work</span>
        </div>
        <div className="nav-sub">
          <Link href="/tasks" className={path === "/tasks" ? "active" : ""}>
            Tasks
          </Link>
        </div>
      </div>

      {groups.map((g) => (
        <Section key={g.base} group={g} path={path} />
      ))}

      <Link
        href="/settings"
        className={`nav-icon-link ${isActive("/settings") ? "active" : ""}`}
      >
        <svg
          className="nav-icon"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Settings
      </Link>
    </nav>
  );
}

function Section({ group, path }: { group: NavGroup; path: string }) {
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
            ›
          </span>
          {group.title}
        </button>
        <Link
          href={`${group.base}/new`}
          className="nav-add"
          aria-label={`New ${group.title.replace(/s$/, "").toLowerCase()}`}
        >
          +
        </Link>
      </div>

      {open && (
        <div className="nav-sub">
          {group.items.length === 0 ? (
            <span className="nav-empty">Nothing yet.</span>
          ) : (
            group.items.map((it) => (
              <Link
                key={it.id}
                href={`${group.base}/${it.id}`}
                className={path === `${group.base}/${it.id}` ? "active" : ""}
              >
                {it.name}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
