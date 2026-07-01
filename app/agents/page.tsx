import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { listModels } from "@/lib/repos/models";
import { listSkills } from "@/lib/repos/skills";
import { listProjects } from "@/lib/repos/projects";
import { AgentsClient } from "./agents-client";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const database = db();
  return (
    <AgentsClient
      agents={listAgents(database)}
      models={listModels(database)}
      skills={listSkills(database)}
      projects={listProjects(database)}
    />
  );
}
