"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setActiveSpaceAction, createSpaceAction } from "./actions";

interface NavItem {
  id: number;
  name: string;
}
export interface NavGroup {
  title: string;
  base: string;
  items: NavItem[];
}

export function Nav({
  groups,
  unreadTasks,
  spaces,
  activeSpaceId,
}: {
  groups: NavGroup[];
  /** Tasks needing attention (settled + unseen); shown as a badge on Tasks. */
  unreadTasks: number;
  spaces: NavItem[];
  activeSpaceId: number;
}) {
  const path = usePathname();
  const isActive = (href: string) =>
    path === href || path.startsWith(href + "/");

  return (
    <nav className="nav">
      <SpaceSwitcher spaces={spaces} activeSpaceId={activeSpaceId} />

      <div className="nav-group">
        <div className="nav-group-head">
          <span className="nav-group-label">Work</span>
        </div>
        <div className="nav-sub">
          <Link
            href="/tasks"
            className={`nav-task${path === "/tasks" ? " active" : ""}`}
          >
            Tasks
            {unreadTasks > 0 && (
              <span className="nav-badge" aria-label={`${unreadTasks} tasks need attention`}>
                {unreadTasks > 99 ? "99+" : unreadTasks}
              </span>
            )}
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

/** Top-of-sidebar Space switcher: shows the active Space and, on click, a menu
 *  to switch between Spaces or create a new one. Switching is a pure view change
 *  (running work keeps going); rename/delete live on the Settings page. */
function SpaceSwitcher({
  spaces,
  activeSpaceId,
}: {
  spaces: NavItem[];
  activeSpaceId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const active = spaces.find((s) => s.id === activeSpaceId);

  // Close on click/tap outside the switcher, and on Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function switchTo(id: number) {
    if (id === activeSpaceId) return setOpen(false);
    setBusy(true);
    await setActiveSpaceAction(id);
    setOpen(false);
    setBusy(false);
    router.refresh();
  }

  function openCreate() {
    setName("");
    setError("");
    setOpen(false);
    setCreating(true);
  }

  function closeCreate() {
    if (busy) return;
    setCreating(false);
    setName("");
    setError("");
  }

  async function create() {
    const n = name.trim();
    if (!n) return setError("Name required.");
    setBusy(true);
    setError("");
    try {
      // createSpaceAction switches the active Space to the new one, so a refresh
      // lands us inside it.
      await createSpaceAction(n);
      setName("");
      setCreating(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-switcher" ref={rootRef}>
      <button
        type="button"
        className="space-current"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="space-name">{active?.name ?? "Space"}</span>
        <span className={`nav-caret ${open ? "open" : ""}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="space-menu">
          <div className="space-menu-label">Switch spaces</div>
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`space-menu-item${s.id === activeSpaceId ? " active" : ""}`}
              disabled={busy}
              onClick={() => switchTo(s.id)}
            >
              {s.name}
              {s.id === activeSpaceId && (
                <span className="space-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}

          <div className="space-menu-sep" />

          <button
            type="button"
            className="space-menu-item space-menu-new"
            onClick={openCreate}
          >
            + New space
          </button>
        </div>
      )}

      {creating &&
        createPortal(
        <div
          className="overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCreate();
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="New space"
          >
            <h3 style={{ margin: 0 }}>New space</h3>
            <input
              autoFocus
              type="text"
              value={name}
              placeholder="Space name"
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape") closeCreate();
              }}
            />
            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={closeCreate}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={create}
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </div>
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
