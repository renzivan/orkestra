"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Skill } from "@/lib/types";
import { saveSkill, deleteSkillAction } from "../actions";
import { deleteConfirmMessage } from "../delete-warning";
import { useConfirm } from "../confirm-dialog";
import { toast } from "../toast";

export function SkillForm({ skill }: { skill: Skill | null }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [name, setName] = useState(skill?.name ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    try {
      const row = await saveSkill({ id: skill?.id, name: name.trim(), body });
      toast.success(skill ? "Skill saved." : "Skill created.");
      if (skill) router.refresh();
      else router.push(`/skills/${row.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!skill) return;
    const message = await deleteConfirmMessage("skill", skill.id, skill.name);
    if (!(await confirm({ title: "Delete skill", message }))) return;
    setError("");
    const res = await deleteSkillAction(skill.id);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    toast.success("Skill deleted.");
    router.push("/skills/new");
    router.refresh();
  }

  return (
    <>
      {dialog}
      <div className="page-head">
        <div>
          <h1>{skill ? skill.name : "New skill"}</h1>
          <p>
            Reusable instruction text layered onto an agent&apos;s base
            instruction.
          </p>
        </div>
        {skill && (
          <button className="btn small danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      <div className="card">
        <div className="stack">
          <div>
            <label>Name</label>
            <input
              type="text"
              value={name}
              placeholder="write-tests"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label>Instruction body (markdown)</label>
            <textarea
              value={body}
              placeholder="Always write a failing test first…"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={busy}>
              {skill ? "Save changes" : "Add skill"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
