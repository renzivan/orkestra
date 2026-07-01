import { db } from "@/lib/db";
import { listProjects } from "@/lib/repos/projects";
import { ProjectsClient } from "./projects-client";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = listProjects(db());
  return <ProjectsClient projects={projects} />;
}
