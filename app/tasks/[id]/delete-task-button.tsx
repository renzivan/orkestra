"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { deleteTaskAction } from "../../actions";
import { useConfirm } from "../../confirm-dialog";

export function DeleteTaskButton({ task, label }: { task: Task; label: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const running = task.status === "running";
    const message = running
      ? `Delete "${label}"?\n\nThis task is running and will be stopped.\n\nThis can't be undone.`
      : `Delete "${label}"? This can't be undone.`;
    if (!(await confirm({ title: "Delete task", message }))) return;
    setError("");
    setBusy(true);
    try {
      const res = await deleteTaskAction(task.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/tasks");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      {dialog}
      <button className="btn small danger" onClick={remove} disabled={busy}>
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
