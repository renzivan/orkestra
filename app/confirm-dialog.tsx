"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based confirmation dialog. Call `confirm(opts)` and await the result;
 * render `dialog` once in the component. Replaces native window.confirm with a
 * styled modal consistent with the app.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    confirmBtn.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const dialog = pending ? (
    <div
      className="overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div className="dialog" role="alertdialog" aria-modal="true">
        <h3 style={{ margin: 0 }}>{pending.title}</h3>
        <p className="muted" style={{ margin: 0 }}>
          {pending.message}
        </p>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            ref={confirmBtn}
            className="btn danger"
            onClick={() => close(true)}
          >
            {pending.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
