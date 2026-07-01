import { db } from "@/lib/db";
import { listSkills } from "@/lib/repos/skills";
import { SkillsClient } from "./skills-client";

export const dynamic = "force-dynamic";

export default function SkillsPage() {
  const skills = listSkills(db());
  return <SkillsClient skills={skills} />;
}
