"use client";

import { useEffect, useState } from "react";

export type ToastKind = "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

// A single Toaster is mounted in the root layout, which persists across App
// Router navigations. A module-level bus lets any client component fire a toast
// without threading a context/provider through every form — and crucially lets a
// toast survive the router.push a save/delete does right after succeeding, since
// the layout (and its Toaster) is never unmounted by that navigation.
type Listener = (t: Toast) => void;
let listener: Listener | null = null;
let nextId = 1;

function emit(kind: ToastKind, message: string): void {
  // No mounted Toaster (e.g. a component firing during tests) — safe no-op.
  listener?.({ id: nextId++, kind, message });
}

/** Fire a transient success/error notification. Callable from any client
 *  component; rendered by the single <Toaster /> in the layout. */
export const toast = {
  success: (message: string) => emit("success", message),
  error: (message: string) => emit("error", message),
};

// How long a toast stays before auto-dismissing.
const TIMEOUT_MS = 4000;

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    listener = (t) => {
      setToasts((prev) => [...prev, t]);
      // Auto-dismiss; the manual close button removes it early via the same set.
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, TIMEOUT_MS);
    };
    return () => {
      listener = null;
    };
  }, []);

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          <span className="toast-icon" aria-hidden="true">
            {t.kind === "success" ? "✓" : "✕"}
          </span>
          <span className="toast-body">{t.message}</span>
          <button
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
