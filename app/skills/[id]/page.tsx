import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSkill } from "@/lib/repos/skills";
import { SkillForm } from "../skill-form";

export const dynamic = "force-dynamic";

export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const skill = getSkill(db(), Number(id));
  if (!skill) notFound();
  return <SkillForm skill={skill} />;
}
