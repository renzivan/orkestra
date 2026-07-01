import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAgent } from "@/lib/repos/agents";
import { AgentForm } from "../agent-form";
import { loadAgentChoices } from "../choices";

export const dynamic = "force-dynamic";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = getAgent(db(), Number(id));
  if (!agent) notFound();

  const { adapters, skills, projects } = loadAgentChoices();
  return (
    <AgentForm
      agent={agent}
      adapters={adapters}
      skills={skills}
      projects={projects}
    />
  );
}
