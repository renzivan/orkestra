import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProject } from "@/lib/repos/projects";
import { ProjectForm } from "../project-form";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = getProject(db(), Number(id));
  if (!project) notFound();
  return <ProjectForm project={project} />;
}
