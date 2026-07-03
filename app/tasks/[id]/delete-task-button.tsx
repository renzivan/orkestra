"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { deleteTaskAction } from "../../actions";
import { taskDeleteMessage } from "@/lib/repos/tasks";
import { useConfirm } from "../../confirm-dialog";
import { toast } from "../../toast";

export function DeleteTaskButton({ task, label }: { task: Task; label: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const message = taskDeleteMessage(label, task.status === "running");
    if (!(await confirm({ title: "Delete task", message }))) return;
    setError("");
    setBusy(true);
    try {
      const res = await deleteTaskAction(task.id);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success("Task deleted.");
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
