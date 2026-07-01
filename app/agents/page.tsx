import { db } from "@/lib/db";
import { listAgents } from "@/lib/repos/agents";
import { listAdapters } from "@/lib/repos/adapters";
import { listSkills } from "@/lib/repos/skills";
import { listProjects } from "@/lib/repos/projects";
import { syncAdapters } from "@/lib/adapters/sync";
import { presetByName } from "@/lib/adapters/presets";
import { AgentsClient, type AdapterChoice } from "./agents-client";

export const dynamic = "force-dynamic";

export default function AgentsPage() {
  const database = db();
  // Adapters are built-in presets, available only when their CLI is installed.
  syncAdapters(database);

  const adapters: AdapterChoice[] = listAdapters(database).map((a) => {
    const preset = presetByName(a.name);
    return {
      id: a.id,
      name: a.name,
      models: preset?.models ?? [],
      efforts: preset?.efforts ?? ["off"],
    };
  });

  return (
    <AgentsClient
      agents={listAgents(database)}
      adapters={adapters}
      skills={listSkills(database)}
      projects={listProjects(database)}
    />
  );
}
