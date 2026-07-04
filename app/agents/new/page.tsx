import { AgentForm } from "../agent-form";
import { loadAgentChoices } from "../choices";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const { adapters, skills, projects } = await loadAgentChoices();
  return (
    <AgentForm
      agent={null}
      adapters={adapters}
      skills={skills}
      projects={projects}
    />
  );
}
