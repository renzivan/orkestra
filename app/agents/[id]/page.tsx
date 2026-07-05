import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getAgent } from "@/lib/repos/agents";
import { agentUsage } from "@/lib/repos/runs";
import { AgentForm } from "../agent-form";
import { loadAgentChoices } from "../choices";

export const dynamic = "force-dynamic";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = db();
  const agent = getAgent(database, Number(id));
  if (!agent) notFound();

  const { adapters, skills, projects } = await loadAgentChoices();
  const usage = agentUsage(database, agent.id);
  return (
    <AgentForm
      agent={agent}
      adapters={adapters}
      skills={skills}
      projects={projects}
      usage={usage}
    />
  );
}
